export const RELEASE_IMAGE_LIMIT: number;
export function releaseImageUrl(value: string): string | null;
export function releaseImageSource(value: string, native?: boolean): string | null;
export function releaseImageResponse(value: string, fetcher?: typeof fetch, signal?: AbortSignal): Promise<Response>;
