import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import {
	useLoaderData,
	useNavigate,
	useParams,
	useSearchParams,
} from '@remix-run/react'
import { useEffect, useState } from 'react'
import { useMount, useWindowSize } from 'react-use'
import { CameraButton } from '~/components/CameraButton'
import { CopyButton } from '~/components/CopyButton'
import { HighPacketLossWarningsToast } from '~/components/HighPacketLossWarningsToast'
import { IceDisconnectedToast } from '~/components/IceDisconnectedToast'
import { LeaveRoomButton } from '~/components/LeaveRoomButton'
import { MicButton } from '~/components/MicButton'
import { OverflowMenu } from '~/components/OverflowMenu'
import { ParticipantLayout } from '~/components/ParticipantLayout'
import { ParticipantsButton } from '~/components/ParticipantsMenu'
import { PullAudioTracks } from '~/components/PullAudioTracks'
/* import { SafetyNumberToast } from '~/components/SafetyNumberToast'
 */import { ScreenshareButton } from '~/components/ScreenshareButton'
import Toast, { useDispatchToast } from '~/components/Toast'
import useBroadcastStatus from '~/hooks/useBroadcastStatus'
import useIsSpeaking from '~/hooks/useIsSpeaking'
import { useRoomContext } from '~/hooks/useRoomContext'
import { useShowDebugInfoShortcut } from '~/hooks/useShowDebugInfoShortcut'
import useSounds from '~/hooks/useSounds'
import useStageManager from '~/hooks/useStageManager'
import { useUserJoinLeaveToasts } from '~/hooks/useUserJoinLeaveToasts'
import getUsername from '~/utils/getUsername.server'
import isNonNullable from '~/utils/isNonNullable'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const username = await getUsername(request)

	return json({
		username,
		disableLobbyEnforcement: context.env.DISABLE_LOBBY_ENFORCEMENT === 'true',
		mode: context.mode,
	})
}

export default function Room() {
	const { joined } = useRoomContext()
	const navigate = useNavigate()
	const { roomName } = useParams()
	const { mode, disableLobbyEnforcement } =
		useLoaderData<typeof loader>()
	const [search] = useSearchParams()

	useEffect(() => {
		if (!joined && mode !== 'development' && !disableLobbyEnforcement)
			navigate(`/${roomName}${search.size > 0 ? '?' + search.toString() : ''}`)
	}, [joined, mode, navigate, roomName, search, disableLobbyEnforcement])

	if (!joined && mode !== 'development' && !disableLobbyEnforcement) return null

	return (
		<Toast.Provider>
			<JoinedRoom />
		</Toast.Provider>
	)
}

function JoinedRoom() {
	const {
		userMedia,
		partyTracks,
		pushedTracks,
		showDebugInfo,
		pinnedTileIds,
		room
	} = useRoomContext()
	const {
		otherUsers,
		websocket,
		identity,
		roomState: { meetingId },
	} = room

	// only want this evaluated once upon mounting
	const [firstUser] = useState(otherUsers.length === 0)

	useEffect(() => {

	}, [firstUser])

	useShowDebugInfoShortcut()

	const [raisedHand/* , setRaisedHand */] = useState(false)
	const speaking = useIsSpeaking(userMedia.audioStreamTrack)

	useMount(() => {
		if (otherUsers.length > 5) {
			userMedia.turnMicOff()
		}
	})

	useBroadcastStatus({
		userMedia,
		partyTracks,
		websocket,
		identity,
		pushedTracks,
		raisedHand,
		speaking,
	})

	useSounds(otherUsers)
	useUserJoinLeaveToasts(otherUsers)

	const { width } = useWindowSize()

	const someScreenshare =
		otherUsers.some((u) => u.tracks.screenShareEnabled) ||
		Boolean(identity?.tracks.screenShareEnabled)
	const stageLimit = width < 600 ? 2 : someScreenshare ? 5 : 9

	const { recordActivity, actorsOnStage } = useStageManager(
		otherUsers,
		stageLimit,
		identity
	)

	useEffect(() => {
		otherUsers.forEach((u) => {
			if (u.speaking || u.raisedHand) recordActivity(u)
		})
	}, [otherUsers, recordActivity])

	const pinnedActors = actorsOnStage.filter((u) => pinnedTileIds.includes(u.id))
	const unpinnedActors = actorsOnStage.filter(
		(u) => !pinnedTileIds.includes(u.id)
	)

	const gridGap = 12

	return (
		<PullAudioTracks
			audioTracks={otherUsers.map((u) => u.tracks.audio).filter(isNonNullable)}
		>
			<div className="flex flex-col h-full bg-black">
				<div className="relative flex-grow isolate">
					<div
						style={{ '--gap': gridGap + 'px' } as any}
						className="absolute inset-0 flex isolate p-[--gap] gap-[--gap]"
					>
						{pinnedActors.length > 0 && (
							<div className="flex-grow-[5] overflow-hidden relative">
								<ParticipantLayout
									users={pinnedActors.filter(isNonNullable)}
									gap={gridGap}
									aspectRatio="16:9"
								/>
							</div>
						)}
						<div className="flex-grow overflow-hidden relative">
							<ParticipantLayout
								users={unpinnedActors.filter(isNonNullable)}
								gap={gridGap}
								aspectRatio="4:3"
							/>
						</div>
					</div>
					<Toast.Viewport className="absolute bottom-0 right-0" />
				</div>
				<div className="flex flex-wrap items-center justify-center gap-2 p-2 text-sm md:gap-4 md:p-5 md:text-base">
					<MicButton warnWhenSpeakingWhileMuted />
					<CameraButton />
					<ScreenshareButton />
					<ParticipantsButton
						identity={identity}
						otherUsers={otherUsers}
						className="hidden md:block"
					></ParticipantsButton>
					<OverflowMenu />
					<LeaveRoomButton
						meetingId={meetingId}
					/>
					{showDebugInfo && meetingId && (
						<CopyButton contentValue={meetingId}>Meeting Id</CopyButton>
					)}
				</div>
			</div>
			<HighPacketLossWarningsToast />
			<IceDisconnectedToast />
		</PullAudioTracks>
	)
}
