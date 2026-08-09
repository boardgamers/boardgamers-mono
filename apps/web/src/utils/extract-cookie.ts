export function extractCookie(name: string, cookie: string): any {
	const cookies = cookie.split(";").map((x) => x.trim());

	const extracted = cookies.find((x) => x.startsWith(`${name}=`));

	const val = extracted?.slice(name.length + 1);
	if (!val) {
		return undefined;
	}

	// Cookie values may arrive percent-encoded (e.g. the API's refreshToken JSON). Decode
	// then JSON.parse; a malformed encoding or a non-JSON value must never crash SSR —
	// return undefined, as if the cookie were absent.
	try {
		return JSON.parse(decodeURIComponent(val));
	} catch {
		try {
			return JSON.parse(val);
		} catch {
			return undefined;
		}
	}
}
