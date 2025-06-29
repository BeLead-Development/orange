import type { FC } from 'react'
import { cn } from '~/utils/style'

interface DisclaimerProps {
	className?: string
}

export const Disclaimer: FC<DisclaimerProps> = ({ className }) => {
	return (
        <footer className="text-center text-xs text-zinc-500 py-4">
            © 2025 <a className="font-semibold text-indigo-500 hover:underline hover:text-indigo-700 transition-all" href='https://belead.io/' target='_blanck'>BeLead</a> — Lead your talks, effortlessly.&nbsp;·&nbsp;
            <a href="https://help.belead.io/legals/terms-of-service.html" target='_blanck' className="underline hover:text-zinc-700">Terms</a>&nbsp;·&nbsp;
            <a href="https://help.belead.io/legals/privacy-policy.html" target='_blanck' className="underline hover:text-zinc-700">Privacy</a>&nbsp;·&nbsp;
            <a href="https://help.belead.io/" target='_blanck' className="underline hover:text-zinc-700">Help Center</a>
        </footer>
	)
}
