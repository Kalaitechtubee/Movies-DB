
import providerManager from './src/core/providerManager.js';

const url = 'https://isaidub.love/movie/a-knight-of-the-seven-kingdoms-2026-tamil-dubbed-web-series/';
const detected = providerManager.detectProviderFromUrl(url);

console.log(`URL: ${url}`);
console.log(`Detected: ${detected}`);

providerManager.getProviders().forEach(p => {
    console.log(`Provider: ${p.id}, BaseURL: ${p.config?.baseUrl}`);
});
