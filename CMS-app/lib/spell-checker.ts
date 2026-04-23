import nspell from "nspell";
import { getFile } from "@/lib/storage";

let spellChecker: ReturnType<typeof nspell> | null = null;

export function resetSpellChecker() {
  spellChecker = null;
}

export async function getSpellChecker(): Promise<ReturnType<typeof nspell>> {
  if (spellChecker) return spellChecker;
  const dictionary = await import("dictionary-en");
  spellChecker = nspell(dictionary.default.aff, dictionary.default.dic);

  // Add common technical / CMS / product terms that aren't in the dictionary
  const customWords = [
    // Product names
    "beqom", "CMS", "Madcap", "Flare", "TipTap", "ProseMirror",
    // Tech terms
    "API", "APIs", "URL", "URLs", "HTML", "CSS", "JSON", "XML",
    "JavaScript", "TypeScript", "React", "NextJS", "NodeJS",
    "frontend", "backend", "middleware", "webhook", "webhooks",
    "dropdown", "checkbox", "tooltip", "sidebar", "navbar",
    "login", "signup", "username", "email", "auth",
    "config", "configs", "metadata", "enum", "enums",
    "param", "params", "async", "sync", "cron",
    "SSO", "OAuth", "SAML", "LDAP", "RBAC",
    "SaaS", "onboarding", "workflow", "workflows",
    "repo", "repos", "changelog", "readme",
    "UI", "UX", "WYSIWYG", "iframe", "iframes",
    "localhost", "dev", "prod", "env",
    "slugify", "regex", "boolean", "timestamp",
    "MDX", "YAML", "TOML", "CSV", "PDF", "DOCX",
    "png", "jpg", "jpeg", "svg", "gif", "webp",
    "img", "src", "href", "alt", "div", "pre",
    // Common documentation terms
    "e.g", "i.e", "etc", "vs",
    "admin", "admins", "deprovisioning", "provisioning",
    "multi", "pre", "un", "re",
    "submenu", "subpage", "subsection",
  ];
  for (const word of customWords) {
    spellChecker.add(word);
  }

  // Load custom dictionary from CMS content if it exists
  try {
    const customDict = await getFile("content/custom-dictionary.json");
    const parsed = JSON.parse(customDict.content);
    if (Array.isArray(parsed.words)) {
      for (const word of parsed.words) {
        spellChecker.add(word);
      }
    }
  } catch {
    // No custom dictionary, that's fine
  }

  return spellChecker;
}
