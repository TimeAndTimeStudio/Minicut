# GitHub Credentials (Internal Reference)

> ⚠️ DO NOT commit actual tokens to git. See `.gitignore` for `key.git`.

## Personal Access Token
- **File:** `key.git` (NOT tracked in git — see `.gitignore`)
- **Repository:** https://github.com/TimeAndTimeStudio/Minicut
- **Username:** timeandtime

## Usage
```bash
git remote add origin https://timeandtime:<TOKEN>@github.com/TimeAndTimeStudio/Minicut.git
```

## Security Notes
- `key.git` is ignored by `.gitignore`
- GitHub push protection blocks commits containing tokens
- Use SSH keys or GitHub CLI (`gh auth login`) for future pushes
- If token expires: regenerate at https://github.com/settings/tokens
