const baseUrl = "/api";

function transformUrl(url: string) {
  return url.startsWith("http") || url.startsWith("//") ? url : baseUrl + url;
}

export async function get(url: string) {
  const response = await fetch(transformUrl(url));

  if (response.headers.get("content-type")?.startsWith("text/plain")) {
    return response.text();
  }
  return response.json();
}

export async function post(url: string, data: Record<string, unknown>) {
  return (
    await fetch(transformUrl(url), {
      method: "POST",
      body: JSON.stringify(data),
      headers: { "Content-Type": "application/json" },
    })
  ).json();
}
