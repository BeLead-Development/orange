import type { ActionFunction, LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json, redirect } from '@remix-run/cloudflare'
import { Form, useLoaderData, useNavigate } from '@remix-run/react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import invariant from 'tiny-invariant'
import { Button, ButtonLink } from '~/components/Button'
import { Disclaimer } from '~/components/Disclaimer'
import { Input } from '~/components/Input'
import { Label } from '~/components/Label'
import { useUserMetadata } from '~/hooks/useUserMetadata'
import { ACCESS_AUTHENTICATED_USER_EMAIL_HEADER } from '~/utils/constants'
import getUsername from '~/utils/getUsername.server'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const directoryUrl = context.USER_DIRECTORY_URL
	const username = await getUsername(request)
	invariant(username)
	const usedAccess = request.headers.has(ACCESS_AUTHENTICATED_USER_EMAIL_HEADER)
	return json({ username, usedAccess, directoryUrl })
}

export const action: ActionFunction = async ({ request }) => {
	const room = (await request.formData()).get('room')
	invariant(typeof room === 'string')
	return redirect(room.replace(/ /g, '-'))
}

export default function Index() {
	const { username, usedAccess } = useLoaderData<typeof loader>()
	const navigate = useNavigate()
	const { data } = useUserMetadata(username)

    const [roomNotFound, setRoomNotFound] = useState(false);

    useEffect(() => {
        // on cherche la query error
        const urlParams = new URLSearchParams(window.location.search);
        const error = urlParams.get('error');
        console.log('error', error);
        if (error === 'meeting-not-found') {
            setRoomNotFound(true);
        } else {
            setRoomNotFound(false);
        }
        // remove the error from the URL
        if (error) {
            urlParams.delete('error');
            window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`);
        }
    }, []);

	return (
		<div className="flex flex-col items-center justify-center h-full p-4 mx-auto">
			<div className="flex-1"></div>
			<div className="space-y-2 sm:min-w-96">
				<div>
                    
					<h1 className="text-3xl font-bold"><a className="hover:text-indigo-500 transition-all" target='_blanck' href='https://belead.io/'>BeLead</a> Meet</h1>
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							You will be displayed as <span className='font-bold'>{data?.displayName}</span>
						</p>
						{/* {!usedAccess && (
							<a
								className="block text-sm underline text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
								href="/set-username"
							>
								Change
							</a>
						)} */}
					</div>
				</div>
				{/* {data?.displayName == "Miguel" && (<div>
					<ButtonLink
						to="/new"
						className="text-sm"
						onClick={(e) => {
							// We shouldn't need a whole server visit to start a new room,
							// so let's just do a redirect here
							e.preventDefault()
							navigate(`/${nanoid(8)}`)
							// if someone clicks the link to create a new room
							// before the js has loaded then we'll use a server side redirect
							// (in new.tsx) to send the user to a new room
						}}
					>
						New Room
					</ButtonLink>
				</div>
                )} */}
				{/* <details className="cursor-pointer">
					<summary className="text-zinc-500 dark:text-zinc-400">
						Or join a room
					</summary>
					<Form
						className="grid items-end gap-4 grid-cols-[1fr_auto] w-full pt-4"
						method="post"
					>
						<div className="space-y-2">
							<Label htmlFor="room">Room name</Label>
							<Input name="room" id="room" required />
						</div>
						<Button className="text-xs" type="submit" displayType="secondary">
							Join
						</Button>
					</Form>
				</details> */}
                <Form
                    className="grid items-end gap-4 grid-cols-[1fr_auto] w-full pt-4"
                    method="post"
                >
                    <div className="space-y-2">
                        <Label htmlFor="room">Room code</Label>
                        <Input name="room" id="room" placeholder='6861889d7cd22d' required />
                    </div>
                    <Button className="text-xs" type="submit" displayType="primary">
                        Join
                    </Button>
                </Form>
                {roomNotFound && (
                    <p className="text-sm bg-red-100 text-red-800 p-2 rounded">
                        The meeting you tried to join does not exist or has ended.
                    </p>
                )}
			</div>
			<div className="flex flex-col justify-end flex-1">
				<Disclaimer className="pt-6" />
			</div>
		</div>
	)
}
