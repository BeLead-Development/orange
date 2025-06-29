import type { Env } from '~/types/Env'
import type { ClientMessage, ServerMessage, User } from '~/types/Messages'
import { assertError } from '~/utils/assertError'
import assertNever from '~/utils/assertNever'
import { assertNonNullable } from '~/utils/assertNonNullable'
import getUsername from '~/utils/getUsername.server'

import {
	Server,
	type Connection,
	type ConnectionContext,
	type WSMessage,
} from 'partyserver'
import { log } from '~/utils/logging'

const alarmInterval = 15_000

/**
 * The ChatRoom Durable Object Class
 *
 * ChatRoom implements a Durable Object that coordinates an
 * individual chat room. Participants connect to the room using
 * WebSockets, and the room broadcasts messages from each participant
 * to all others.
 */
export class ChatRoom extends Server<Env> {
	env: Env

	// static options = { hibernate: true }

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		this.env = env
	}

	// a small typesafe wrapper around connection.send
	sendMessage<M extends ServerMessage>(connection: Connection, message: M) {
		connection.send(JSON.stringify(message))
	}

    async isRoomValid(env: Env, roomCode: string | null): Promise<Response> {
        if (!roomCode) return new Response('Room code is null', { status: 400 });
        // todo check sub-worker usage
        const resp = await /* env.API. */fetch(
            `https://api.belead.io/meeting/room/${roomCode}`,         // host inutile pour un service binding
            {
                method: 'GET',
                headers: {
                    'x-internal-key': `${env.INTERNAL_KEY}`,
                    'Content-Type': 'application/json',
                },
            },
        );

        console.log(`isRoomValid response: ${resp.status} ${resp.statusText}`);

        return resp
    }

    async  updateMeetingStats(
        env: Env,
        roomId: string,
        payload: { peakUsers: number; status: 'done' | 'started' },
    ) {
        // todo check sub-worker usage
        const resp = await /* env.API. */fetch(
            `https://api.belead.io/meeting/room/${roomId}`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-internal-key': env.INTERNAL_KEY,
                },
                body: JSON.stringify(payload),
            },
        );

        return resp.ok
    }

	async onStart(): Promise<void> {
       const roomCode = await this.ctx.storage.get<string>('roomCode');
        if (!roomCode) {
            console.warn('roomCode absent – onStart devrait tourner après onConnect');
            return;
        }

        const valid = await this.isRoomValid(this.env, roomCode);
        console.log(`Room code "${roomCode}" validity check: ${valid}`);

        if (!valid.ok) {
            await this.ctx.storage.deleteAlarm();
            for (const c of this.getConnections()) c.close(4004, 'Room invalid');
            await this.ctx.storage.deleteAll();
            return;
        }

        // TODO: make this a part of partyserver
		// this.ctx.setWebSocketAutoResponse(
		// 	new WebSocketRequestResponsePair(
		// 		JSON.stringify({ type: 'partyserver-ping' }),
		// 		JSON.stringify({ type: 'partyserver-pong' })
		// 	)
		// )
	}

    extractRoomCode(urlStr: string): string | null {
        const segments = new URL(urlStr).pathname.split('/');
        const idx = segments.indexOf('rooms');
        return idx !== -1 && idx + 1 < segments.length ? segments[idx + 1] : null;
    }

    getRoomCode(): Promise<string | undefined> {
        return this.ctx.storage.get<string>('roomCode');
    }

	async onConnect(
		connection: Connection<User>,
		ctx: ConnectionContext
	): Promise<void> {
        const roomCode = this.extractRoomCode(ctx.request.url);
        if (roomCode && !(await this.ctx.storage.get('roomCode'))) {
            console.log(`New room code detected: ${roomCode}`);
            await this.ctx.storage.put('roomCode', roomCode);   // on le mémorise
        }
        // check room code validity
        const validRoom = await this.isRoomValid(this.env, roomCode)
        if (!validRoom.ok) {
            // send a close message the the client
            console.warn(`Invalid or finished room, closing connection for room: ${roomCode}`)
            connection.send(
                JSON.stringify({
                    type: 'error',
                    error: 'Room invalid',
                } satisfies ServerMessage)
            )
            connection.close(4004, 'Meeting room no longer active')
            return
        }
        const meetingId = await this.getMeetingId()

		// let's start the periodic alarm if it's not already started
		if (!(await this.ctx.storage.getAlarm())) {
			// start the alarm to broadcast state every 30 seconds
			this.ctx.storage.setAlarm(Date.now() + alarmInterval)
		}

		const username = await getUsername(ctx.request)
		assertNonNullable(username)

		let user = await this.ctx.storage.get<User>(`session-${connection.id}`)
		const foundInStorage = user !== undefined
		if (!foundInStorage) {
			user = {
				id: connection.id,
				name: username,
				joined: false,
				raisedHand: false,
				speaking: false,
				tracks: {
					audioEnabled: false,
					audioUnavailable: false,
					videoEnabled: false,
					screenShareEnabled: false,
				},
			}
		}

		// store the user's data in storage
		await this.ctx.storage.put(`session-${connection.id}`, user)
		await this.ctx.storage.put(`heartbeat-${connection.id}`, Date.now())
		await this.trackPeakUserCount()
		await this.broadcastRoomState()
		log({
			eventName: 'onConnect',
			meetingId,
			foundInStorage,
			connectionId: connection.id,
		})
	}

	async trackPeakUserCount() {
		let meetingId = await this.getMeetingId()
		const meeting = meetingId
			? await this.getMeeting(meetingId)
			: await this.createMeeting()
		await this.cleanupOldConnections()
        if (!meeting) {
            console.warn('No meeting found or created, cannot track peak user count')
            return
        }

        const previousCount = meeting.peakUserCount
        const userCount = (await this.getUsers()).size
        if (userCount > previousCount || meeting.ended !== null) {
            await this.updateMeetingStats(
                this.env,
                meeting.roomId,
                { peakUsers: meeting.peakUserCount, status: 'started' },
            )
        }
		return meetingId
	}

	async getMeetingId() {
		return this.ctx.storage.get<string>('meetingId')
	}

	async createMeeting(): Promise<any> {
        const meetingId = crypto.randomUUID()
		await this.ctx.storage.put('meetingId', meetingId)
		log({ eventName: 'startingMeeting', meetingId })
        return this.getMeeting(meetingId)
	}

	async getMeeting(meetingId: string) {
        const roomCode = await this.getRoomCode()
        if (!roomCode) {
            console.warn('No room code found, cannot get meeting')
            return null
        }
        const meeting = await this.isRoomValid(this.env, roomCode)

        if (!meeting.ok) {
            console.warn(`Meeting with id ${meetingId} not found or invalid`)
            return null
        }
        const response = await meeting.json() as {
            data: {
                roomId: string
                peakUsers: number
                status: 'planned' | 'started' | 'done' | 'cancelled' | 'no_show'
            }
        }
        if (!response) {
            console.warn(`No response body found for meeting with id ${meetingId}`)
            return null
        }

		return {
            roomId: roomCode,
            ended: ["done", "canceled", "no_show"].includes(response.data.status),
            peakUserCount: response.data.peakUsers,
            id: meetingId,
        }
	}

	async broadcastMessage(
		message: ServerMessage,
		excludedConnection?: Connection
	) {
		let didSomeoneQuit = false
		const meetingId = await this.getMeetingId()
		const messageAsString = JSON.stringify(message)

		for (const connection of this.getConnections()) {
			try {
				if (excludedConnection && connection === excludedConnection) continue
				connection.send(messageAsString)
			} catch (err) {
				connection.close(1011, 'Failed to broadcast state')
				log({
					eventName: 'errorBroadcastingToUser',
					meetingId,
					connectionId: connection.id,
				})
				await this.ctx.storage.delete(`session-${connection.id}`)
				didSomeoneQuit = true
			}
		}

		if (didSomeoneQuit) {
			// broadcast again to remove the user who quit
			await this.broadcastRoomState()
		}
	}

	async broadcastRoomState() {
		const meetingId = await this.getMeetingId()
        if (!meetingId) {
            return this.broadcastMessage({
                type: 'error',
                error: 'No meetingId found, closing connection',
            } satisfies ServerMessage)
        }
		const roomState = {
			type: 'roomState',
			state: {
				meetingId,
				users: [
					...(await this.getUsers()).values(),
				],
			},
		} satisfies ServerMessage
		return this.broadcastMessage(roomState)
	}

	async onClose(
		connection: Connection,
		code: number,
		reason: string,
		wasClean: boolean
	) {
		const meetingId = await this.getMeetingId()
		log({
			eventName: 'onClose',
			meetingId,
			connectionId: connection.id,
			code,
			reason,
			wasClean,
		})
	}

	async onMessage(
		connection: Connection<User>,
		message: WSMessage
	): Promise<void> {
		try {
			const meetingId = await this.getMeetingId()
			if (typeof message !== 'string') {
				console.warn('Received non-string message')
				return
			}

			let data: ClientMessage = JSON.parse(message)

			switch (data.type) {
				case 'userLeft': {
					connection.close(1000, 'User left')
					this.userLeftNotification(connection.id)
					await this.ctx.storage
						.delete(`session-${connection.id}`)
						.catch(() => {
							console.warn(
								`Failed to delete session session-${connection.id} on userLeft`
							)
						})
					await this.ctx.storage
						.delete(`heartbeat-${connection.id}`)
						.catch(() => {
							console.warn(
								`Failed to delete session session-heartbeat-${connection.id} on userLeft`
							)
						})
					log({ eventName: 'userLeft', meetingId, connectionId: connection.id })

					await this.broadcastRoomState()
					break
				}
				case 'userUpdate': {
					this.ctx.storage.put(`session-${connection.id}`, data.user)
					await this.broadcastRoomState()
					break
				}
				case 'callsApiHistoryEntry': {
					const { entry, sessionId } = data
					log({
						eventName: 'clientNegotiationRecord',
						connectionId: connection.id,
						meetingId,
						entry,
						sessionId,
					})
					break
				}
				case 'directMessage': {
					const { to, message } = data
					const fromUser = await this.ctx.storage.get<User>(
						`session-${connection.id}`
					)

					for (const otherConnection of this.getConnections<User>()) {
						if (otherConnection.id === to) {
							this.sendMessage(otherConnection, {
								type: 'directMessage',
								from: fromUser!.name,
								message,
							})
							break
						}
					}
					console.warn(
						`User with id "${to}" not found, cannot send DM from "${fromUser!.name}"`
					)
					break
				}
				case 'muteUser': {
					const user = await this.ctx.storage.get<User>(
						`session-${connection.id}`
					)
					let mutedUser = false
					for (const otherConnection of this.getConnections<User>()) {
						if (otherConnection.id === data.id) {
							const otherUser = await this.ctx.storage.get<User>(
								`session-${data.id}`
							)
							await this.ctx.storage.put(`session-${data.id}`, {
								...otherUser!,
								tracks: {
									...otherUser!.tracks,
									audioEnabled: false,
								},
							})
							this.sendMessage(otherConnection, {
								type: 'muteMic',
							})

							await this.broadcastRoomState()
							mutedUser = true
							break
						}
					}
					if (!mutedUser) {
						console.warn(
							`User with id "${data.id}" not found, cannot mute user from "${user!.name}"`
						)
					}
					break
				}
				case 'partyserver-ping': {
					// do nothing, this should never be received
					console.warn(
						"Received partyserver-ping from client. You shouldn't be seeing this message. Did you forget to enable hibernation?"
					)
					break
				}
				case 'heartbeat': {
					await this.ctx.storage.put(`heartbeat-${connection.id}`, Date.now())
					break
				}
				default: {
					assertNever(data)
					break
				}
			}
		} catch (error) {
			const meetingId = await this.getMeetingId()
			log({
				eventName: 'errorHandlingMessage',
				meetingId,
				connectionId: connection.id,
				error,
			})
			assertError(error)
			// TODO: should this even be here?
			// Report any exceptions directly back to the client. As with our handleErrors() this
			// probably isn't what you'd want to do in production, but it's convenient when testing.
			this.sendMessage(connection, {
				type: 'error',
				error: error.stack,
			} satisfies ServerMessage)
		}
	}

	onError(connection: Connection, error: unknown): void | Promise<void> {
		log({
			eventName: 'onErrorHandler',
			error,
		})
		return this.getMeetingId().then((meetingId) => {
			log({
				eventName: 'onErrorHandlerDetails',
				meetingId,
				connectionId: connection.id,
				error,
			})
			this.broadcastRoomState()
		})
	}

	getUsers() {
		return this.ctx.storage.list<User>({
			prefix: 'session-',
		})
	}

	async endMeeting(meetingId: string) {
		log({ eventName: 'endingMeeting', meetingId })
		const roomCode = await this.getRoomCode()
        await this.ctx.storage.deleteAll()
        if (!roomCode) {
            console.warn('No room code found, cannot end meeting')
            return
        }
        const meeting = await this.getMeeting(meetingId)
        const ended = await this.updateMeetingStats(this.env, roomCode, {
            peakUsers: meeting?.peakUserCount ?? 0,
            status: 'done',
        })
        if (!ended) {
            console.warn(`Failed to end meeting with id ${meetingId}`)
            return
        }
	}

	userLeftNotification(id: string) {
		this.broadcastMessage({
			type: 'userLeftNotification',
			id,
		})
	}

	async cleanupOldConnections() {
		const meetingId = await this.getMeetingId()
		if (!meetingId) log({ eventName: 'meetingIdNotFoundInCleanup' })
		const now = Date.now()
		const users = await this.getUsers()
		let removedUsers = 0
		const connections = [...this.getConnections()]

		for (const [key, user] of users) {
			const connectionId = key.replace('session-', '')
			const heartbeat = await this.ctx.storage.get<number>(
				`heartbeat-${connectionId}`
			)
			if (heartbeat === undefined || heartbeat + alarmInterval < now) {
				this.userLeftNotification(connectionId)
				removedUsers++
				await this.ctx.storage.delete(key).catch(() => {
					console.warn(
						`Failed to delete session ${key} in cleanupOldConnections`
					)
				})

				const connection = connections.find((c) => c.id === connectionId)
				if (connection) {
					connection.close(1011)
				}
				log({ eventName: 'userTimedOut', connectionId: user.id, meetingId })
			}
		}

		const activeUserCount = (await this.getUsers()).size

		if (meetingId && activeUserCount === 0) {
			this.endMeeting(meetingId)
		} else if (removedUsers > 0) {
			this.broadcastRoomState()
		}

		return activeUserCount
	}

	async alarm(): Promise<void> {
		const meetingId = await this.getMeetingId()
		log({ eventName: 'alarm', meetingId })
		const activeUserCount = await this.cleanupOldConnections()
		await this.broadcastRoomState()
		if (activeUserCount !== 0) {
			this.ctx.storage.setAlarm(Date.now() + alarmInterval)
		}
	}
}
