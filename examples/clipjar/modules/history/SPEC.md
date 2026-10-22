# History requirements

- **HISTORY-1** (MUST) (inferred) Clips survive quitting and relaunching. They are kept in a local database in the support directory, with large image data as separate files beside it.
- **HISTORY-2** (MUST) (inferred) Identical content is stored once, where identical means equal after line endings are normalised. Copying stored content again moves that clip to the top and fills in missing rich-text or source details. It adds no clip.
- **HISTORY-3** (MUST) (inferred) Clips are ordered newest first by when they were last copied or pasted, with a stable tie-break.
- **HISTORY-4** (MUST) (inferred) Automatic removal by count or age never removes a pinned clip, and pinned clips do not count toward the count limit.
- **HISTORY-5** (MUST) (inferred) A clip deleted by the user, by clearing or by automatic removal is erased from the database files, including search index and write-ahead data, not merely hidden. Its image files are deleted. Erasing after automatic removal may be deferred briefly, and after a user deletion happens at once.
- **HISTORY-6** (MUST) (inferred) The support directory, its image folder and the database files are accessible to the user's account only, re-applied at every launch.
- **HISTORY-7** (MUST) (inferred) A database that is damaged, at launch or when a later check fails, is set aside under a name marking it damaged, and an empty history starts in its place. The user is told, and the old file is kept for them to inspect or delete.
- **HISTORY-8** (SHOULD) (inferred) When the support directory cannot be used, or another instance holds it, the tool keeps an in-memory history for the session and says it will not be saved. Image data in that mode is removed at quit.
