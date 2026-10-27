# Message reactions

Nest messages (including Polls, RSVPs, Assignments and attachments), thread replies and Churp private messages open a focused view after a 750 ms hold. Its top row has four quick controls: 👍, ❤️, 😂 and a button opening a searchable collection of 80 emojis. Message actions appear below the selected message. The normal chat shows only message details and chosen reaction pills. Selected reactions appear as pills beneath the message, grouped by emoji with a count. Your own choices are highlighted; labels and hover text identify who reacted.

Each person can have up to **five different emojis per message**. Adding a sixth removes that person's oldest selected emoji. Choosing an already-selected emoji removes it; choosing it again adds it at the end of that person's selection order. Other people's reactions are unaffected. Equivalent heart variation forms are normalized so they cannot create duplicates.

Reactions persist across devices and refresh live in other open clients. They are separate from message text: reacting creates no new chat bubble, unread message, push alert or change to the message's edit history. Members may react to an admin-only Nest announcement even when they cannot post text replies. Deleted messages lose their reaction data. These controls do not send SMS reactions to external phone recipients.

## Access and encryption

Production reactions are signed and encrypted on the user's device, using the existing messaging identity, trusted contact keys and archived keys for decryption. The server stores one current encrypted selection per user and message; no plaintext emoji is stored or returned in production. Plaintext storage exists only in the existing legacy browser fixtures where encrypted messaging is explicitly disabled.

A Nest reaction is encrypted only for current members who were recipients of the original message and still have access to its history. A late joiner cannot read or react to an earlier message. A private reaction is encrypted for the participants and currently authorized parents who can already read the original private message. Blocking, revoked adult-message approval and incomplete youth protection pause new private reactions. Parent-review screens show reactions read-only and do not mark messages read for the child.

The signed packet binds the author, channel, target message, client update ID, version, audience hash, encrypted payload hash and reaction count. The server validates the count (0–5), signatures and exact encrypted audience and uses a transaction to recheck access, device approval, audience and version. Clients validate decrypted counts, allowed emojis and uniqueness. Empty selections retain a versioned tombstone so a stale device cannot resurrect removed reactions. Conflicting device updates reload the current selection and retry once.

Initial reaction reads are batched in groups of 200 loaded messages; the same provider serves the main Nest view and open thread. Private message and Nest IDs are separate scopes. Foreign keys clean up selections and their recipient records when messages, users or conversations are removed.

## Verification

`tests/reactions.test.js` covers oldest replacement, uniqueness, normalization, removal/re-add order, encrypted persistence, idempotency, stale versions, forged and cross-message signatures, quiet updates, Nest history boundaries, blocking, parent approval and guardian read-only access. `e2e/reactions.spec.js` checks the quick controls, searchable picker, independent per-user limits, live counts, reload persistence and thread/private reactions on desktop and phone layouts. The existing family browser workflow checks parent review and approval revocation with the new reaction components present.
