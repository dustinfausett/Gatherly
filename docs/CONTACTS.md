# Adding contacts

**Contacts → Add contact** opens a segmented **From Tree / From Phone** control, defaulting to From Tree. **Import contacts** opens the same dialog on From Phone. Switching tabs preserves each tab’s selection while the dialog stays open.

## From Tree

Filter by Tree or search names, then tap **+ Add** on as many members as desired. **Select all shown** selects the eligible visible results. A single **Add N contacts** action saves the batch. No name or phone-number form is required: the server copies each selected member’s current display name and explicit account ID. This does not expose or guess anyone’s phone number.

An optional Birdhouse destination supports either an existing owned Birdhouse or a new one. Existing saved members show **Added** for the current destination. Selecting another Birdhouse makes those saved members available to add to that list without creating duplicate contacts. Protected members retain the existing parent-approval requirement.

`POST /api/contacts/from-tree` accepts `user_ids` (1–1,000 distinct IDs), optional `birdhouse_id` or `new_birdhouse_name`, and returns `added`, `duplicates` and `assigned`. Shared-Tree membership and family eligibility are checked for every member in a transaction before any contact or Birdhouse is created. Supplied names or phone numbers are ignored. Existing aliases and phone numbers are preserved on duplicates. A failed batch leaves no partial contacts or orphan Birdhouse.

## From Phone

- On browsers exposing the Contact Picker API, **Choose from phone contacts** opens the system picker with multiple selection. Access happens only from that button’s user gesture. Returned contacts stay in the browser until the user reviews and confirms which ones to upload.
- **Choose CSV or vCard** imports a selected file. The same existing review screen allows deselection and an optional new/existing Birdhouse. Phone numbers are normalized and duplicates are handled by the existing importer.
- **Add manually** opens a name/phone form within From Phone, with an optional Birdhouse. Editing an already saved contact still supports an explicit Churp-account link.

Some browsers, including many iPhone/Safari installations, do not provide a web contact picker. Churp feature-detects it and explains the fallback: share/export chosen contacts from the phone’s Contacts app as a vCard, save it to Files, then choose that file. CSV is also supported. A native iPhone app is a separate later phase; the web app cannot grant itself address-book access.

Validation covers bulk selection, canonical names, deduplication and Birdhouse membership, atomic failures, parent approval, browser-supported picker review, unsupported-browser/manual fallback, CSV/vCard imports, and phone/desktop layouts.
