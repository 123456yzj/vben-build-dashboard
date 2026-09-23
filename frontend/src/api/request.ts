export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body: unknown = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error || `HTTP ${response.status}`);
  return body as T;
}
