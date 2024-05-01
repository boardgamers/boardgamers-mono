export const AVATAR_STYLES = Object.freeze([
  "adventurer",
  "adventurer-neutral",
  "avataaars",
  "big-ears",
  "big-ears-neutral",
  "big-smile",
  "bottts",
  "croodles",
  "croodles-neutral",
  "gridy",
  "identicon",
  "initials",
  "jdenticon",
  "micah",
  "miniavs",
  "open-peeps",
  "personas",
  "pixel-art",
  "pixel-art-neutral",
  "upload",
]);
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export interface User<T = string> {
  _id: T;

  account: {
    username: string;
    email?: string;
    password: string;
    karma: number;
    termsAndConditions: Date;
    social: {
      google?: string;
      facebook?: string;
      discord?: string;
    };
    avatar: AvatarStyle;
    bio: string;
  };
  settings: {
    mailing: {
      newsletter: boolean;
      game: {
        /** Delay before sending a mail notification, in seconds */
        delay: number;
        /** Are email notifications enabled? */
        activated: boolean;
      };
    };
    game: {
      /** Are sound notifications enabled? */
      soundNotification: boolean;
    };
    home: {
      /** Show my games instead of featured games */
      showMyGames: boolean;
    };
  };
  security: {
    lastIp: string;
    lastLogin: {
      ip: string;
      date: Date;
    };
    // Last sign of activity - but can be stuff like automated jwt renewal
    lastActive: Date;
    // Last actively online (tab active)
    lastOnline: Date;
    confirmed: boolean;
    confirmKey?: string;
    reset?: {
      key: string;
      issued: Date;
    };
    // Slug of the username, to guarantee unicity
    slug: string;
  };
  meta: {
    nextGameNotification?: Date;
    lastGameNotification?: Date;
  };
  authority?: "admin";

  createdAt: Date;
  updatedAt: Date;
}
