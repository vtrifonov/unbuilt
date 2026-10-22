# History scenarios

Rewritten as behaviour from the original's tests of ingestion, pruning, scrubbing and recovery.

## History survives a restart

Covers: HISTORY-1, HISTORY-3
Given the user copied three different sentences in order
When the tool quits and starts again
Then the picker lists the same three clips, newest first.

## Repeats are merged

Covers: HISTORY-2, HISTORY-3
Given a stored clip, and two clips copied after it
When the user copies the same text again, with different line endings
Then no clip is added and the original moves to the top.

## Pinned clips survive pruning

Covers: HISTORY-4
Given a low count limit and a pinned oldest clip
When newer clips exceed the limit
Then the oldest unpinned clips are removed and the pinned clip stays, without using up a place.

## Deleted text leaves no trace

Covers: HISTORY-5
Given a text clip with a distinctive phrase and an image clip
When the user deletes both
Then no database file contains the phrase and the image file is gone.

## Files are private

Covers: HISTORY-6
Given a support directory with loose permissions
When the tool launches
Then the directory, image folder and database files are accessible to the user's account only.

## Damaged storage is replaced or bypassed

Covers: HISTORY-7, HISTORY-8
Given the database file has been overwritten with garbage
When the tool launches
Then the garbage file is kept under a name marking it damaged, the history starts empty, and a banner says it was reset.
Given instead that the support directory cannot be created
When the user copies a sentence
Then it is listed and a banner says it will not be saved, and it is gone after a restart.
