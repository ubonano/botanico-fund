---
name: skill-generator
description: Generates and structures new Antigravity Skills following official standards. Use when the user asks to create, scaffold, or design a new skill.
---

# Skill Generator

This skill guides the agent in creating valid, well-structured skills for Antigravity. It ensures that new skills strictly follow the official documentation, including proper folder structure, YAML frontmatter, and clear instruction sections.

## When to use this skill

- When the user explicitly asks to create a new skill (e.g., "Create a skill for testing", "Scaffold a new skill").
- When the user asks to "globalize" a skill or move it to a different scope.
- When the user needs a template or boilerplate for a new skill.
- When the user asks to "fix" or "restructure" an existing skill to match official standards.

## How to use it

Follow these steps to generate or update a skill:

### 1. Requirements Gathering
Before generating files, confirm the following with the user if not already specified:
- **Skill Name**: Should be in `kebab-case` (e.g., `skill-generator`, `code-review`).
- **Scope**:
    - **Workspace**: `<workspace-root>/.agent/skills/<skill-name>/` (Default for project-specific tasks).
    - **Global**: `~/.gemini/antigravity/global_skills/<skill-name>/` (For general tools usable everywhere).
- **Purpose**: A short description of what the skill does.

### 2. Folder Structure Creation
Create the necessary directories. Do not create unnecessary subfolders unless requested (e.g., `scripts/` only if there are scripts).

```text
<skill-folder>/
└─── SKILL.md
```

### 3. SKILL.md Generation
Write the `SKILL.md` file using the following template. **Do not deviate from this structure.**

```markdown
---
name: <skill-name>
description: <Short description for the agent>
---

# <Skill Title>

<Detailed instructions for the agent go here.>

## When to use this skill

- Use this when...
- This is helpful for...

## How to use it

<Step-by-step guidance, conventions, and patterns the agent should follow.>
```

### 4. Best Practices to Apply
- **Frontmatter**: Ensure `name` and `description` are present.
- **Description**: crucial for the agent's discovery. Write it in the third person (e.g., "Generates unit tests...").
- **Atomic**: The skill should focus on one specific domain or task.
- **Clear Instructions**: Use numbered lists for steps and bullet points for checklists.

### 5. Validation
After creating the files, verify:
- The path is correct based on the requested scope.
- The `SKILL.md` file starts with the YAML frontmatter.
- The headers matches the official structure (`# Title`, `## When to use`, `## How to use`).