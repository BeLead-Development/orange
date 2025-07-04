import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import { Outlet, useLoaderData, useParams } from '@remix-run/react'
import { useObservableAsValue, useValueAsObservable } from 'partytracks/react'
import { useMemo, useState } from 'react'
import { of } from 'rxjs'
import invariant from 'tiny-invariant'
import { EnsureOnline } from '~/components/EnsureOnline'
import { EnsurePermissions } from '~/components/EnsurePermissions'
import { Icon } from '~/components/Icon/Icon'
import { Spinner } from '~/components/Spinner'

import { usePeerConnection } from '~/hooks/usePeerConnection'
import useRoom from '~/hooks/useRoom'
import { type RoomContextType } from '~/hooks/useRoomContext'
import { useRoomHistory } from '~/hooks/useRoomHistory'
import { useStablePojo } from '~/hooks/useStablePojo'
import useUserMedia from '~/hooks/useUserMedia'
import type { TrackObject } from '~/utils/callsTypes'
import { getIceServers } from '~/utils/getIceServers.server'
import { mode } from '~/utils/mode'

function numberOrUndefined(value: unknown): number | undefined {
	const num = Number(value)
	return isNaN(num) ? undefined : num
}

function trackObjectToString(trackObject?: TrackObject) {
	if (!trackObject) return undefined
	return trackObject.sessionId + '/' + trackObject.trackName
}

export const loader = async ({ context }: LoaderFunctionArgs) => {
	const {
		env: {
			MAX_WEBCAM_FRAMERATE,
			MAX_WEBCAM_BITRATE,
			MAX_WEBCAM_QUALITY_LEVEL,
			EXPERIMENTAL_SIMULCAST_ENABLED,
		},
	} = context

	return json({
		userDirectoryUrl: context.env.USER_DIRECTORY_URL,
		iceServers: await getIceServers(context.env),
		maxWebcamFramerate: numberOrUndefined(MAX_WEBCAM_FRAMERATE),
		maxWebcamBitrate: numberOrUndefined(MAX_WEBCAM_BITRATE),
		maxWebcamQualityLevel: numberOrUndefined(MAX_WEBCAM_QUALITY_LEVEL),
		simulcastEnabled: EXPERIMENTAL_SIMULCAST_ENABLED === 'true',
	})
}

export default function RoomWithPermissions() {
	return (
		<EnsurePermissions>
			<EnsureOnline
				fallback={
					<div className="grid h-full place-items-center">
						<div>
							<h1 className="flex items-center gap-3 text-3xl font-black">
								<Icon type="SignalSlashIcon" />
								You are offline
							</h1>
						</div>
					</div>
				}
			>
				<RoomPreparation />
			</EnsureOnline>
		</EnsurePermissions>
	)
}

function RoomPreparation() {
	const { roomName } = useParams()
	invariant(roomName)
	const userMedia = useUserMedia()
	const room = useRoom({ roomName, userMedia })

	return room.roomState.meetingId ? (
		<Room room={room} userMedia={userMedia} />
	) : (
		<div className="grid place-items-center h-full">
			<Spinner className="text-gray-500" />
		</div>
	)
}

function tryToGetDimensions(videoStreamTrack?: MediaStreamTrack) {
	if (videoStreamTrack === undefined) {
		return { height: 0, width: 0 }
	}
	const height = videoStreamTrack?.getSettings().height ?? 0
	const width = videoStreamTrack?.getSettings().width ?? 0
	return { height, width }
}

interface RoomProps {
	room: ReturnType<typeof useRoom>
	userMedia: ReturnType<typeof useUserMedia>
}

function Room({ room, userMedia }: RoomProps) {
	const [joined, setJoined] = useState(false)
	const [dataSaverMode, setDataSaverMode] = useState(false)
	const [audioOnlyMode, setAudioOnlyMode] = useState(false)
	const { roomName } = useParams()
	invariant(roomName)

	const {
		userDirectoryUrl,
		iceServers,
		maxWebcamBitrate = 2_500_000,
		maxWebcamFramerate = 24,
		maxWebcamQualityLevel = 1080,
		simulcastEnabled,
	} = useLoaderData<typeof loader>()

	const params = new URLSearchParams()

	invariant(room.roomState.meetingId, 'Meeting ID cannot be missing')
	params.set('correlationId', room.roomState.meetingId)

	const { partyTracks, iceConnectionState } = usePeerConnection({
		apiExtraParams: params.toString(),
		iceServers,
	})
	const roomHistory = useRoomHistory(partyTracks, room)

	const scaleResolutionDownBy = useMemo(() => {
		if (dataSaverMode) return 4
		const videoStreamTrack = userMedia.videoStreamTrack
		const { height, width } = tryToGetDimensions(videoStreamTrack)
		// we need to do this in case camera is in portrait mode
		const smallestDimension = Math.min(height, width)
		return Math.max(smallestDimension / maxWebcamQualityLevel, 1)
	}, [maxWebcamQualityLevel, userMedia.videoStreamTrack, dataSaverMode])

	const sendEncodings = useStablePojo<RTCRtpEncodingParameters[]>(
		simulcastEnabled
			? [
					{
						rid: 'a',
						maxBitrate: 1_300_000,
						maxFramerate: 30.0,
						active: !dataSaverMode,
					},
					{
						rid: 'b',
						scaleResolutionDownBy: 2.0,
						maxBitrate: 500_000,
						maxFramerate: 24.0,
						active: true,
					},
				]
			: [
					{
						maxFramerate: maxWebcamFramerate,
						maxBitrate: maxWebcamBitrate,
						scaleResolutionDownBy,
					},
				]
	)
	const sendEncodings$ = useValueAsObservable(sendEncodings)

	const pushedVideoTrack$ = useMemo(
		() =>
			partyTracks.push(userMedia.videoTrack$, {
				sendEncodings$,
			}),
		[partyTracks, userMedia.videoTrack$, sendEncodings$]
	)

	const pushedVideoTrack = useObservableAsValue(pushedVideoTrack$)

	const pushedAudioTrack$ = useMemo(
		() =>
			partyTracks.push(userMedia.publicAudioTrack$, {
				sendEncodings$: of([{ networkPriority: 'high' }]),
			}),
		[partyTracks, userMedia.publicAudioTrack$]
	)
	const pushedAudioTrack = useObservableAsValue(pushedAudioTrack$)

	const pushedScreenSharingTrack$ = useMemo(
		() => partyTracks.push(userMedia.screenShareVideoTrack$),
		[partyTracks, userMedia.screenShareVideoTrack$]
	)
	const pushedScreenSharingTrack = useObservableAsValue(
		pushedScreenSharingTrack$
	)
	const [pinnedTileIds, setPinnedTileIds] = useState<string[]>([])
	const [showDebugInfo, setShowDebugInfo] = useState(mode !== 'production')

	const context: RoomContextType = {
		joined,
		setJoined,
		pinnedTileIds,
		setPinnedTileIds,
		showDebugInfo,
		setShowDebugInfo,
		dataSaverMode,
		setDataSaverMode,
		audioOnlyMode,
		setAudioOnlyMode,
		userMedia,
		userDirectoryUrl,
		partyTracks,
		roomHistory,
		iceConnectionState,
		room,
		simulcastEnabled,
		pushedTracks: {
			video: trackObjectToString(pushedVideoTrack),
			audio: trackObjectToString(pushedAudioTrack),
			screenshare: trackObjectToString(pushedScreenSharingTrack),
		},
	}

	return <Outlet context={context} />
}
