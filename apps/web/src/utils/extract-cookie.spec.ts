import { extractCookie } from "./extract-cookie";

describe("extract-cookie", () => {
  it("should extract a refresh token", () => {
    expect(
      extractCookie(
        "refreshToken",
        'token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjViNTc2MGVlZGU0MzRlMzE3YzczNWQwMyIsInVzZXJuYW1lIjoiY295b3R0ZTUwOCIsImVtYWlsIjoiY295b3R0ZTUwOEBnbWFpbC5jb20iLCJpYXQiOjE2Mzk3NzUzOTcsImV4cCI6MTYzOTc3ODk5N30.QgSpycGo6QfI4DqFYMCpWt5I7Bd0pzhvL7IcgAEmH4oeSLAsXFLvMNvdJnUZyqEyJw-8zw8yddoKaIIyZUK9eC02uNvGP8_VqTwq1nvCyVpKGn_FSELAI5ttrpBs0ysIBpGkdhek4xuJpftzJWWgmFu09QEjpF9fidvKYRTCKeyyXHdIYADD0sIzk1dXtQd9yXHXvuAxm26wLxHZZZ3xm5xAbsfv3dvvdG9o5Pp7fe65TFGcGUtmDHfSTT7ZY2XzptZFHhyR2c7XfD9_iFq6UDbvPMkaVPyuPcupSh48QWEHRQ_1bmupZvrWtsahZGYOwuUTGuUrw2JuZRojm_RhYw; token.sig=bJEvijJQNGwmQPnh0XXXXP1RGDo; sidebarOpen=true; refreshToken={"code":"r+YVQ/5AZPOXAfubxDTXC","expiresAt":1650143334413}'
      )
    ).toEqual({ code: "r+YVQ/5AZPOXAfubxDTXC", expiresAt: 1650143334413 });
  });
});
