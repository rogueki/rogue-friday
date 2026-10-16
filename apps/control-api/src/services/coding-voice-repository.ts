import type { Db } from "../db/database";
import { conflict, validationFailed } from "../util/errors";
import type { CodingRunsService } from "./coding-runs";

export interface CodingVoiceRepository {
  alias: string;
  repository: string;
  revision: number;
}

/** One owner-selected project; voice never accepts a spoken filesystem path. */
export class CodingVoiceRepositoryService {
  constructor(private readonly db: Db, private readonly codingRuns: CodingRunsService) {}

  get(): CodingVoiceRepository {
    const row = this.db.prepare("SELECT revision, alias, repository FROM coding_voice_repository WHERE id = 1")
      .get() as CodingVoiceRepository | undefined;
    return row ?? { revision: 0, alias: "", repository: "" };
  }

  async put(input: { alias: string; repository: string }, expectedRevision: number | undefined): Promise<CodingVoiceRepository> {
    if (expectedRevision === undefined) throw validationFailed("If-Match mit der aktuellen Repository-Revision ist erforderlich.");
    const alias = input.alias.trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{1,31}$/u.test(alias)) throw validationFailed("Der Projektname muss 2 bis 32 einfache Zeichen enthalten.");
    const current = this.get();
    if (current.revision !== expectedRevision) throw conflict("Das Sprachprojekt wurde inzwischen geändert.", { currentRevision: current.revision });
    const repository = await this.codingRuns.prepareVoiceRepository(input.repository);
    const next = { alias, repository, revision: expectedRevision + 1 };
    const timestamp = new Date().toISOString();
    const result = expectedRevision === 0
      ? this.db.prepare("INSERT INTO coding_voice_repository (id, revision, alias, repository, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
        .run(next.revision, alias, repository, timestamp)
      : this.db.prepare("UPDATE coding_voice_repository SET revision = ?, alias = ?, repository = ?, updated_at = ? WHERE id = 1 AND revision = ?")
        .run(next.revision, alias, repository, timestamp, expectedRevision);
    if (result.changes !== 1) throw conflict("Das Sprachprojekt wurde inzwischen geändert.", { currentRevision: this.get().revision });
    return next;
  }

  resolve(alias: string, revision: number): string {
    const current = this.get();
    if (!current.alias || current.alias.normalize("NFKC").toLocaleLowerCase("de") !== alias.normalize("NFKC").toLocaleLowerCase("de") || current.revision !== revision) {
      throw conflict("Das Sprachprojekt wurde geändert. Bitte den Auftrag erneut bestätigen.");
    }
    return this.codingRuns.canonicalRepository(current.repository);
  }
}
