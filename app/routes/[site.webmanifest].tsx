import { json } from 'react-router'

export const loader = async () => {
	return json({
		name: 'BeLead Meet',
		short_name: 'BeLead Meet',
		icons: [
			{
				src: '/android-chrome-192x192.png',
				sizes: '192x192',
				type: 'image/png',
			},
			{
				src: '/android-chrome-512x512.png',
				sizes: '512x512',
				type: 'image/png',
			},
		],
		theme_color: '#ffffff',
		background_color: '#ffffff',
		display: 'standalone',
	})
}
