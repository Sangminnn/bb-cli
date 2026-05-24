export type OutputOptions = {
  json?: boolean;
};

export type RepoRef = {
  workspace: string;
  repo: string;
};

export type Credentials = {
  username: string;
  appPassword: string;
};

export type StoredConfig = {
  credentials?: Credentials;
  defaultRepo?: string;
};
