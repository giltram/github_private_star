export interface GitHubRepository {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  private: boolean;
  permissions?: {
    pull: boolean;
    push: boolean;
  };
}

export interface GitHubAuthenticatedUser {
  login: string;
}

export interface GitHubContentFile {
  type: "file";
  encoding: "base64";
  content: string;
  sha: string;
}

export interface GitHubPutContentResponse {
  content: {
    sha: string;
  } | null;
}

export interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
}
