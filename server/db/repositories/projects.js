import { normalizeLookup } from '../../pipeline/normalizer.js'

export function createProjectRepository(db) {
  return {
    list() {
      const projects = db.prepare('SELECT * FROM projects WHERE active = 1 ORDER BY canonical_name').all()
      const aliases = db.prepare('SELECT * FROM project_aliases WHERE verified = 1').all()
      return projects.map((project) => ({
        ...project,
        aliases: aliases.filter((alias) => alias.project_id === project.id).map((alias) => alias.alias),
      }))
    },
    add({ id, canonicalName, aliases = [], version = 'manual-v1' }) {
      const now = new Date().toISOString()
      const transaction = db.transaction(() => {
        db.prepare(`
          INSERT INTO projects(id, canonical_name, verified_at, dictionary_version)
          VALUES (?, ?, ?, ?)
        `).run(id, canonicalName, now, version)
        const insertAlias = db.prepare(`
          INSERT INTO project_aliases(project_id, alias, alias_normalized, alias_type, source, verified, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `)
        for (const alias of aliases) insertAlias.run(id, alias, normalizeLookup(alias), 'manual', 'human', now)
      })
      transaction()
      return this.list().find((project) => project.id === id)
    },
  }
}
