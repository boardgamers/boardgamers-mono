export function extractCookie(name: string, cookie: string): string | undefined {
  const cookies = cookie.split(";").map((x) => x.trim());

  const extracted = cookies.find((x) => x.startsWith(`${name}=`));

  return extracted?.slice(name.length + 1);
}
