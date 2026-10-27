import { releaseImageSource } from '../../electron/release-images.mjs';

export type ReleaseNotesBlock = {kind:'text'; text:string} | {kind:'image'; alt:string; source:string};

/** A small image extension to plain notes. Everything else stays literal, including HTML. */
export function releaseNotesBlocks(text: string, native = false): ReleaseNotesBlock[] {
  const blocks: ReleaseNotesBlock[] = [];
  const images = /!\[([^\]\n]*)\]\(<?([^\s<>()]+)>?\)/g;
  let from = 0;
  for (const match of text.matchAll(images)) {
    const source = releaseImageSource(match[2]!,native);
    if (!source) continue;
    if (match.index! > from) blocks.push({kind:'text',text:text.slice(from,match.index)});
    blocks.push({kind:'image',alt:match[1]!,source});
    from = match.index! + match[0].length;
  }
  if (from < text.length) blocks.push({kind:'text',text:text.slice(from)});
  return blocks;
}

export function releaseNotesElement(text: string, unavailable: string, native = false): HTMLElement {
  const container = document.createElement('div'); container.className = 'release-notes';
  for (const block of releaseNotesBlocks(text,native)) {
    if (block.kind === 'text') {
      if (!block.text.trim()) continue;
      const paragraph = document.createElement('pre'); paragraph.textContent = block.text.trim();
      container.append(paragraph); continue;
    }
    const figure = document.createElement('figure'), image = document.createElement('img');
    image.alt = block.alt; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    const caption = document.createElement('figcaption'); caption.textContent = block.alt;
    const failure = document.createElement('p'); failure.className = 'release-image-unavailable'; failure.hidden = true;
    failure.textContent = unavailable; failure.setAttribute('role','status');
    image.addEventListener('error',() => { image.hidden = true; failure.hidden = false; },{once:true});
    image.src = block.source;
    figure.append(image,caption,failure); container.append(figure);
  }
  return container;
}
