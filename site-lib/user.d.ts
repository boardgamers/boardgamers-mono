export interface IAbstractUser {
  account: {
    username: string;
    email: string;
    password: string;
    karma: number;
    termsAndConditions: Date;
    social: {
      google: string;
      facebook: string;
      discord: string;
    };
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
    confirmKey: string;
    reset: {
      key: string;
      issued: Date;
    };
    // Slug of the username, to guarantee unicity
    slug: string;
  };
  meta: {
    nextGameNotification: Date;
    lastGameNotification: Date;
  };
  authority: string;
}

export interface IUser extends IAbstractUser {
  _id: string;
}
