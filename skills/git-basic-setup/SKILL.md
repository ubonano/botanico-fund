---
name: git-basic-setup
description: Initializes a git repo, adds all files, makes an initial commit, and guides the user to publish.
---

# Git Basic Setup

This skill assists the agent in performing a basic Git setup for a project. It handles initialization, staging, committing, and prepares for publishing.

## When to use this skill

- When the user asks to "create a repo" or "initialize git".
- When the user asks to "save everything to git" or "make a first commit".
- When the user asks to "subir todo" (upload everything) or "publicar la rama" (publish the branch) for a new project.

## How to use it

Follow these steps to setup git for the project.
**IMPORTANT**: The user prefers to be spoken to in **Spanish**. All your output messages and questions to the user should be in Spanish.

### 1. Check for Existing Repo
Check if `.git` directory exists in the current working directory.
- If it exists, inform the user: "Ya existe un repositorio de git en este directorio." and ask if they want to proceed with adding/committing anyway.

### 2. Initialize Git
If no repo exists:
1.  Run `git init -b main` (or just `git init` and then rename branch if needed, ensuring the main branch is named `main` or based on user preference if stated).
2.  Create a standard `.gitignore` if one doesn't exist (or check if one needs to be created for the specific language/framework of the project). **Do not overwrite** an existing `.gitignore` without asking.

### 3. Stage and Commit
1.  Run `git add .` to stage all files.
2.  Run `git status` to see what will be committed (optional, for your context).
3.  Run `git commit -m "Initial commit"` (or a message reflecting the current state if not strictly "initial", e.g., "Add project files").

### 4. Publish / Push
1.  Check for remote: `git remote -v`.
2.  If **no remote** exists:
    *   Ask the user if they have a remote URL to push to, or if they want you to help create one (e.g., using `gh` CLI if available).
    *   Example question: "El repositorio local está listo. ¿Tienes una URL remota para hacer push, o quieres que intente crear el repo en GitHub (si tienes 'gh' instalado)?"
    *   If they provide a URL:
        *   `git remote add origin <url>`
        *   `git push -u origin main`
3.  If **remote exists**:
    *   `git push -u origin main` (or the current branch name).

### 5. Final Confirmation
Notify the user that the git setup is complete.
- Example: "Listo. Se ha inicializado el repositorio y se ha hecho el commit inicial."
