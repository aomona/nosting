'use client';
import {M3eLoadingIndicator} from '@m3e/react/loading-indicator';
import {M3eTheme} from '@m3e/react/theme';

// Loaded only in the browser: the Web Components depend on HTMLElement.
export default function StartupIndicator({dark}:{dark:boolean}) {
 return <M3eTheme color="#426427" scheme={dark?'dark':'light'} motion="expressive"><M3eLoadingIndicator variant="contained" aria-hidden="true"/></M3eTheme>;
}
