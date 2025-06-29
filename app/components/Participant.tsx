import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useObservableAsValue } from 'partytracks/react'
import { forwardRef, useMemo, useRef } from 'react'
import { Flipped } from 'react-flip-toolkit'
import { combineLatest, fromEvent, map, of, switchMap } from 'rxjs'
/* import { useDeadPulledTrackMonitor } from '~/hooks/useDeadPulledTrackMonitor' */
import useIsSpeaking from '~/hooks/useIsSpeaking'
import { useRoomContext } from '~/hooks/useRoomContext'
import { screenshareSuffix } from '~/hooks/useStageManager'
import { useUserMetadata } from '~/hooks/useUserMetadata'
import { useVideoDimensions } from '~/hooks/useVideoDimensions'
import type { User } from '~/types/Messages'
import isNonNullable from '~/utils/isNonNullable'
/* import populateTraceLink from '~/utils/populateTraceLink' */
import { ewma } from '~/utils/rxjs/ewma'
import { getPacketLoss$ } from '~/utils/rxjs/getPacketLoss$'
import { cn } from '~/utils/style'
import { usePulledVideoTrack } from '../hooks/usePulledVideoTrack'
import { AudioGlow } from './AudioGlow'
import { AudioIndicator } from './AudioIndicator'
import { Button } from './Button'
import {
	ConnectionIndicator,
	getConnectionQuality,
} from './ConnectionIndicator'
import { HoverFade } from './HoverFade'
import { Icon } from './Icon/Icon'
/* import { MuteUserButton } from './MuteUserButton'
 */import { OptionalLink } from './OptionalLink'
import { usePulledAudioTrack } from './PullAudioTracks'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'
import { VideoSrcObject } from './VideoSrcObject'

function useMid(track?: MediaStreamTrack) {
	const { partyTracks } = useRoomContext()
	const transceivers$ = useMemo(
		() =>
			combineLatest([
				partyTracks.peerConnection$,
				partyTracks.peerConnection$.pipe(
					switchMap((peerConnection) => fromEvent(peerConnection, 'track'))
				),
			]).pipe(map(([pc]) => pc.getTransceivers())),
		[partyTracks.peerConnection$]
	)
	const transceivers = useObservableAsValue(transceivers$, [])
	if (!track) return null
	return transceivers.find(
		(t) => t.sender.track === track || t.receiver.track === track
	)?.mid
}

interface Props {
	user: User
}

export const Participant = forwardRef<
	HTMLDivElement,
	JSX.IntrinsicElements['div'] & Props
>(({ user, style }, ref) => {
	const { data } = useUserMetadata(user.name)
	const {
		partyTracks,
		dataSaverMode,
		simulcastEnabled,
		audioOnlyMode,
		pinnedTileIds,
		setPinnedTileIds,
		showDebugInfo,
		userMedia,
		room: { identity },
	} = useRoomContext()
	const peerConnection = useObservableAsValue(partyTracks.peerConnection$)
	const id = user.id
	const isSelf = identity && id.startsWith(identity.id)
	const isScreenShare = id.endsWith(screenshareSuffix)
	const isAi = user.id === 'ai'
	const aiAudioTrack = usePulledAudioTrack(isAi ? user.tracks.audio : undefined)
	const isSpeaking =
		useIsSpeaking(user.id === 'ai' ? aiAudioTrack : undefined) || user.speaking
	const pulledAudioTrack = usePulledAudioTrack(
		isScreenShare ? undefined : user.tracks.audio
	)
	const shouldPullVideo = isScreenShare || (!isSelf && !audioOnlyMode)
	let preferredRid: string | undefined = undefined
	if (!isScreenShare && simulcastEnabled) {
		// If datasaver mode is off, we want server-side bandwidth estimation and switching
		// so we will specify empty string to indicate we have no preferredRid
		preferredRid = dataSaverMode ? 'b' : ''
	}
	const pulledVideoTrack = usePulledVideoTrack(
		shouldPullVideo ? user.tracks.video : undefined,
		preferredRid
	)
	const audioTrack = isSelf ? userMedia.audioStreamTrack : pulledAudioTrack
	const videoTrack =
		isSelf && !isScreenShare ? userMedia.videoStreamTrack : pulledVideoTrack

	/* useDeadPulledTrackMonitor(
		user.tracks.video,
		identity?.transceiverSessionId,
		!!user.tracks.video,
		videoTrack,
		user.name
	)

	useDeadPulledTrackMonitor(
		user.tracks.audio,
		identity?.transceiverSessionId,
		!!user.tracks.audio,
		audioTrack,
		user.name
	) */

	const pinned = pinnedTileIds.includes(id)

	const packetLoss$ = useMemo(
		() =>
			getPacketLoss$(
				partyTracks.peerConnection$,
				of([audioTrack, videoTrack].filter(isNonNullable))
			).pipe(ewma(5000)),
		[audioTrack, partyTracks.peerConnection$, videoTrack]
	)

	const packetLoss = useObservableAsValue(packetLoss$, 0)

	const videoRef = useRef<HTMLVideoElement>(null)
	const { videoHeight, videoWidth } = useVideoDimensions(videoRef)

	const audioMid = useMid(audioTrack)
	const videoMid = useMid(videoTrack)

	return (
		<div
        className="grow shrink text-base basis-[calc(var(--flex-container-width)_-_var(--gap)_*_3)]"
        ref={ref}
			style={style}
		>
			<Flipped flipId={id + pinned}>
				<div
					className={cn(
						'h-full mx-auto overflow-hidden text-white bg-slate-900 opacity-0 animate-fadeIn',
						'relative max-w-[--participant-max-width] rounded-xl'
					)}
				>
					{!isScreenShare && !user.tracks.videoEnabled && (
						<div
							className={cn(
								'absolute inset-0 h-full w-full grid place-items-center'
							)}
						>
							<div className="h-[2em] w-[2em] grid place-items-center text-4xl md:text-6xl 2xl:text-8xl relative">
								{data?.photob64 ? (
									<div>
										<AudioGlow
											className="absolute inset-0 w-full h-full rounded-full"
											audioTrack={audioTrack}
											type="box"
										></AudioGlow>
										<img
											className="rounded-full"
											src={`data:image/png;base64,${data.photob64}`}
											alt={data.displayName}
										/>
									</div>
								) : (
									<span className="relative grid w-full h-full uppercase rounded-full place-items-center bg-zinc-500">
										{isSpeaking && (
											<AudioGlow
												type="text"
												className="absolute uppercase"
												audioTrack={audioTrack}
											>
												{user.name.charAt(0)}
											</AudioGlow>
										)}
										{user.name.charAt(0)}
									</span>
								)}
							</div>
						</div>
					)}
					<VideoSrcObject
						ref={videoRef}
						className={cn(
							'absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity',
							isSelf && !isScreenShare && '-scale-x-100',
							!isScreenShare && 'object-cover',
							{
								'opacity-100': isScreenShare
									? user.tracks.screenShareEnabled
									: user.tracks.videoEnabled && (!audioOnlyMode || isSelf),
							},
							isSelf && isScreenShare && 'opacity-75'
						)}
						videoTrack={videoTrack}
					/>
					{shouldPullVideo && !pulledVideoTrack && (
						<div className="absolute inset-0 grid w-full h-full place-items-center">
							<Spinner className="h-8 w-8" />
						</div>
					)}
					<HoverFade className="absolute inset-0 grid w-full h-full place-items-center">
						<div className="flex gap-2 p-2 rounded bg-zinc-900/30">
							<Tooltip content={pinned ? 'Restore' : 'Maximize'}>
								<Button
									onClick={() =>
										setPinnedTileIds((ids) =>
											pinned ? ids.filter((i) => i !== id) : [...ids, id]
										)
									}
									displayType="ghost"
								>
									<Icon type={pinned ? 'arrowsIn' : 'arrowsOut'} />
								</Button>
							</Tooltip>
							{/* {!isScreenShare && (
								<MuteUserButton
									displayType="ghost"
									mutedDisplayType="ghost"
									user={user}
								/>
							)} */}
						</div>
					</HoverFade>
					{audioTrack && !isScreenShare && (
						<div className="absolute left-4 top-4">
							{user.tracks.audioEnabled &&
								user.tracks.videoEnabled &&
								isSpeaking && <AudioIndicator audioTrack={audioTrack} />}

							{!user.tracks.audioEnabled && !user.tracks.audioUnavailable && (
								<Tooltip content="Mic is turned off">
									<div className="indication-shadow">
										<Icon type="micOff" />
										<VisuallyHidden>Mic is muted</VisuallyHidden>
									</div>
								</Tooltip>
							)}
							{user.tracks.audioUnavailable && (
								<Tooltip content="Mic is unavailable. User cannot unmute.">
									<div className="indication-shadow">
										<Icon type="micOff" className="text-red-400" />
										<VisuallyHidden>Mic is muted</VisuallyHidden>
									</div>
								</Tooltip>
							)}
						</div>
					)}
					{data?.displayName && user.transceiverSessionId && (
						<div className="flex items-center gap-2 absolute m-2 text-shadow left-1 bottom-1">
							<ConnectionIndicator quality={getConnectionQuality(packetLoss)} />
							<OptionalLink
								className="leading-none text-sm"
								/* href={populateTraceLink(user.transceiverSessionId, traceLink)} */
								target="_blank"
								rel="noopener noreferrer"
							>
								{data.displayName}
								{showDebugInfo && peerConnection && (
									<span className="opacity-50">
										{' '}
										{[
											audioMid && `audio mid: ${audioMid}`,
											videoMid && `video mid: ${videoMid}`,
											`vid size: ${videoWidth}x${videoHeight}`,
											!isSelf &&
												preferredRid &&
												`preferredRid: ${preferredRid}`,
										]
											.filter(Boolean)
											.join(' ')}
									</span>
								)}
							</OptionalLink>
						</div>
					)}
					{(isSpeaking || user.raisedHand) && !isScreenShare && (
						<div
							className={cn(
								'pointer-events-none absolute inset-0 h-full w-full border-4 border-indigo-400',
								!pinned && 'rounded-xl'
							)}
						></div>
					)}
				</div>
			</Flipped>
		</div>
	)
})

Participant.displayName = 'Participant'
