export function parseHtmlMetadata(html: string) {
  if (!html) {
    return {
      title: 'Untitled Page',
      slug: 'untitled-page',
      excerpt: '',
      author: 'Editorial Team',
      featuredImage: ''
    };
  }

  // Extract Title
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  let title = '';
  if (titleMatch) {
    // Take the main part of the title before pipe or dash
    title = titleMatch[1].split('|')[0].split('—')[0].trim();
  }
  if (!title) {
    title = 'Untitled Page';
  }

  // Generate Slug
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  // Extract Excerpt / Meta Description
  const descMatch = html.match(/<meta\s+name="description"\s+content="([\s\S]*?)"/i) || 
                    html.match(/<meta\s+property="og:description"\s+content="([\s\S]*?)"/i);
  const excerpt = descMatch ? descMatch[1].trim() : '';

  // Extract Author
  const authorMatch = html.match(/<meta\s+name="author"\s+content="([\s\S]*?)"/i) || 
                      html.match(/<meta\s+property="og:author"\s+content="([\s\S]*?)"/i);
  const author = authorMatch ? authorMatch[1].trim() : 'Editorial Team';

  // Extract Featured Image (og:image, twitter:image, or first <img> src tag)
  const ogImgMatch = html.match(/<meta\s+property="og:image"\s+content="([\s\S]*?)"/i) ||
                     html.match(/<meta\s+name="twitter:image"\s+content="([\s\S]*?)"/i);
  let featuredImage = ogImgMatch ? ogImgMatch[1].trim() : '';
  if (!featuredImage) {
    const imgMatch = html.match(/<img[^>]+src="([^">]+)"/i);
    if (imgMatch) {
      featuredImage = imgMatch[1];
    }
  }

  return { title, slug, excerpt, author, featuredImage };
}
