/** Response from your deployed Instagram resolver (see workers/ + README). */
export interface InstagramResolveItem {
  url: string;
  filename: string;
}

export interface InstagramResolveResponse {
  title?: string;
  description?: string;
  thumbnail?: string;
  items: InstagramResolveItem[];
}
