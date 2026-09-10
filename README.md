# GitHub Private Star

GitHub Private Star is a Chrome extension for privately bookmarking GitHub repositories. Your bookmarks are stored in a JSON file inside a private GitHub repository that you control. They are not added to your public GitHub stars.

## Features

- Add or remove a private star from a repository page.
- View, search, open, and manage private stars from your GitHub profile.
- Open Private Stars from the GitHub user menu.
- Keep all data in your own private repository—no external server or database.

## Setup

1. Create a **private** GitHub repository, for example `github-private-stars`.
2. Create a GitHub **fine-grained Personal Access Token (PAT)**.
3. Give the token access only to the storage repository, with **Contents: Read and write** permission.
4. Build the extension:

   ```bash
   npm install
   npm run build
   ```

5. Open `chrome://extensions` in Chrome and enable **Developer mode**.
6. Click **Load unpacked** and select the generated `dist` folder.
7. Open the extension options, enter your PAT and storage repository details, then click **Save** and **Test connection**.

## Usage

1. Open the main page of any GitHub repository.
2. Click **☆ Private Star** near the repository actions.
3. To manage saved repositories, open **Private stars** from your GitHub profile tabs or the user navigation menu.

Private Stars are shown only when the extension is installed and you are signed in to the matching GitHub account.

## Development

```bash
npm run typecheck
npm run dev
```

After rebuilding, reload the extension from `chrome://extensions` and refresh GitHub.

## Privacy

The PAT is stored locally in Chrome extension storage and is used only for GitHub API requests. Use a least-privileged fine-grained token and never share it.
