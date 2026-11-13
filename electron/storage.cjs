const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, serialized } = require('./documents.cjs');

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(filePath, value) {
  return serialized(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await atomicWrite(filePath, Buffer.from(JSON.stringify(value), 'utf8'));
    return true;
  });
}

function createStorage(userDataPath) {
  const drafts = path.join(userDataPath, 'recovery');
  const preferences = path.join(userDataPath, 'preferences.json');
  const draftPath = (id) => {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('Invalid draft identifier.');
    return path.join(drafts, `${id}.json`);
  };
  return {
    async loadDrafts() {
      const files = await fs.readdir(drafts, { withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
      });
      const result = [];
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue;
        try {
          const draft = await readJson(path.join(drafts, file.name), null);
          if (draft && typeof draft.text === 'string' && typeof draft.id === 'string') result.push(draft);
        } catch (error) {
          console.warn(`Could not read recovery draft ${file.name}: ${error.message}`);
        }
      }
      return result.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
    },
    saveDraft(draft) {
      if (typeof draft.text !== 'string') throw new TypeError('Draft text is required.');
      return writeJson(draftPath(draft.id), { ...draft, updatedAt: Date.now() });
    },
    deleteDraft(id) {
      const filePath = draftPath(id);
      return serialized(filePath, () => fs.rm(filePath, { force: true }));
    },
    loadPreferences() {
      return readJson(preferences, {});
    },
    savePreferences(prefs) {
      return writeJson(preferences, prefs);
    },
    loadImageReferences() {
      return readJson(path.join(userDataPath, 'image-references.json'), []);
    },
    saveImageReferences(files) {
      return writeJson(path.join(userDataPath, 'image-references.json'), files);
    },
  };
}

module.exports = { createStorage };
