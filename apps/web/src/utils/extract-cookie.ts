export function extractCookie(name: string, cookie: string): any {
	const cookies = cookie.split(";").map((x) => x.trim());

	const extracted = cookies.find((x) => x.startsWith(`${name}=`));

	const val = extracted?.slice(name.length + 1);

	// Cookie values arrive percent-encoded (e.g. the API's refreshToken JSON) — decode
	// before parsing, but fall back to the raw value for plain (non-encoded) cookies.
	const decoded = val && decodeURIComponent(val);

	return decoded && JSON.parse(decoded);
}
