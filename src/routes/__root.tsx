import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from 'next-themes'
import { authMiddleware } from '@/server/functions/auth'
import { getBaseUrl } from '@/server/functions/request'
import {
  createOGMetaTags,
  generateOGImageUrl,
  OGImageConfig,
  OGMetaTags,
} from '@/lib/og-config'

interface MyRouterContext {
  queryClient: QueryClient
}

const scripts: React.DetailedHTMLProps<
  React.ScriptHTMLAttributes<HTMLScriptElement>,
  HTMLScriptElement
>[] = []

if (import.meta.env.VITE_INSTRUMENTATION_SCRIPT_SRC) {
  scripts.push({
    src: import.meta.env.VITE_INSTRUMENTATION_SCRIPT_SRC,
    type: 'module',
  })
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  loader: async () => {
    const { currentUser } = await authMiddleware()
    const baseUrl = await getBaseUrl()

    return {
      currentUser,
      baseUrl,
    }
  },
  head: ({ loaderData }) => {
    const baseUrl =
      typeof window !== 'undefined'
        ? window.location.origin
        : (loaderData?.baseUrl ?? 'https://cinemasync.app')

    const config: OGImageConfig = {
      isCustom: false,
    }

    const ogImageUrl = generateOGImageUrl(config, baseUrl)

    const metadata: OGMetaTags = {
      title: 'CinemaSync',
      description:
        'A private two-user watch-together platform with peer-to-peer video streaming, perfectly synced playback controls, and an intimate dark cinema-inspired UI.',
      image: ogImageUrl,
      url: typeof window !== 'undefined' ? window.location.href : baseUrl,
    }

    const ogTags = createOGMetaTags(metadata)

    return {
      meta: [
        {
          charSet: 'utf-8',
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          title: 'CinemaSync',
        },
        {
          name: 'description',
          content:
            'A private two-user watch-together platform with peer-to-peer video streaming, perfectly synced playback controls, and an intimate dark cinema-inspired UI.',
        },
        ...ogTags.meta,
      ],
      links: [
        {
          rel: 'stylesheet',
          href: appCss,
        },
        {
          rel: 'preconnect',
          href: 'https://fonts.googleapis.com',
        },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossOrigin: 'anonymous',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Cormorant+Garant:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap',
        },
      ],
      scripts: [...scripts],
    }
  },

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          {/* <TanStackDevtools
            config={{
              position: 'bottom-left',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          /> */}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
