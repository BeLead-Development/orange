export type Env = {
	rooms: DurableObjectNamespace
	CALLS_APP_ID: string
	CALLS_APP_SECRET: string
	CALLS_API_URL?: string
    API: Fetcher
    INTERNAL_KEY: string

	DISABLE_LOBBY_ENFORCEMENT?: string
	USER_DIRECTORY_URL?: string
	MAX_WEBCAM_FRAMERATE?: string
	MAX_WEBCAM_BITRATE?: string
	MAX_WEBCAM_QUALITY_LEVEL?: string
	EXPERIMENTAL_SIMULCAST_ENABLED?: string
}
