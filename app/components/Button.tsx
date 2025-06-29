import type { LinkProps } from '@remix-run/react'
import { Link } from '@remix-run/react'
import { forwardRef } from 'react'
import { cn } from '~/utils/style'

const displayTypeMap = {
	primary: [
		'text-white',
		'bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 active:bg-indigo-800',
		'border-indigo-500 hover:border-indigo-600 active:border-indigo-700 active:border-indigo-800',
	],
	secondary: [
		'text-slate-900',
		'bg-white hover:bg-zinc-200 active:bg-zinc-400',
		'border-white hover:border-zinc-200 active:border-zinc-400',
	],
	ghost: [
		'text-white hover:text-zinc-900',
		'bg-transparent hover:bg-white',
		'border-transparent hover:border-white',
	],
	danger: [
		'text-white',
		'bg-red-600 hover:bg-red-700 active:bg-red-800',
		'border-red-600 hover:border-red-700 active:border-red-800',
	],
}

export type ButtonProps = Omit<JSX.IntrinsicElements['button'], 'ref'> & {
	displayType?: keyof typeof displayTypeMap
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, displayType = 'primary', disabled, onClick, ...rest }, ref) => (
		<button
			className={cn(
				'border-4',
				'rounded-2xl',
				'uppercase',
				'font-bold',
				'tracking-widest',
				'py-[.5em] px-[1em]',
				disabled && 'cursor-not-allowed opacity-60',
				displayTypeMap[displayType].join(' '),
				className
			)}
			aria-disabled={disabled}
			onClick={disabled ? (e) => e.preventDefault() : onClick}
			{...rest}
			ref={ref}
		/>
	)
)

Button.displayName = 'Button'

export const ButtonLink = forwardRef<
	HTMLAnchorElement,
	LinkProps & {
		displayType?: keyof typeof displayTypeMap
	}
>(({ className, displayType = 'primary', ...rest }, ref) => (
	// eslint-disable-next-line jsx-a11y/anchor-has-content
	<Link
		className={cn(
			'inline-block',
			'border-4',
			'rounded',
			'uppercase',
			'font-bold',
			'tracking-widest',
			'py-[.5em] px-[1em]',
			displayTypeMap[displayType].join(' '),
			className
		)}
		{...rest}
		ref={ref}
	/>
))

ButtonLink.displayName = 'Button'
