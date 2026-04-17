import * as React from 'react';
import Head from 'next/head';
import { AppProps } from 'next/app';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { CacheProvider, EmotionCache } from '@emotion/react';
import Script from 'next/script';
import { ThemeMode } from '@/lib/mode';
import { themeCreator } from '../theme';
import createEmotionCache from '../createEmotionCache';
import '../styles/style.css';

// Client-side cache, shared for the whole session of the user in the browser.
const clientSideEmotionCache = createEmotionCache();

interface MyAppProps extends AppProps {
  emotionCache: EmotionCache | undefined;
  mode: ThemeMode;
}

export default function MyApp(props: MyAppProps) {
  const {
    Component,
    emotionCache = clientSideEmotionCache,
    pageProps,
  } = props;
  const { mode } = pageProps;

  const theme = React.useMemo(
    () => themeCreator(mode),
    [mode],
  );

  return (
    <CacheProvider value={emotionCache}>
      <Head>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
        <meta name="theme-color" content={theme.palette.primary.main} />
      </Head>
      {process.env.NEXT_PUBLIC_TRACK === 'true' && (
        <Script src="https://daj.pw/js/plausible.js" data-domain="grcpay.gridcoin.club" />
      )}
      <ThemeProvider theme={theme}>
        {/* CssBaseline kickstart an elegant, consistent, and simple baseline to build upon. */}
        <CssBaseline />
        <Component {...pageProps} />
      </ThemeProvider>
    </CacheProvider>
  );
}
