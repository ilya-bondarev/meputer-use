export function postUrl(href) {
  const match=href.match(/^https:\/\/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
  return match?{id:match[2],url:`https://x.com/${match[1]}/status/${match[2]}`} : null;
}
