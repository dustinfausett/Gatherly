# Hold for message options

The normal conversation preserves its sender, timestamp, message content and chosen reaction pills. The permanent quick-reaction toolbar and Reply / Thread / Edit / Urgent / Delete rows have moved into a focused message view.

Hold a message for **750 ms** to open it. The surrounding app is dimmed and inactive; the selected message keeps its existing presentation. Quick reactions and the emoji picker sit above the message. Available actions sit below it, including Copy text. Only actions the user already has permission to perform are shown. Choosing Edit, Reply, Thread or an activity opens its existing flow and dismisses the focused view. Delete keeps its confirmation step.

All chat message renderers use `MessageFocus`: Nest messages, thread replies, Churp private chats, read-only parent review, scheduled previews and external phone texts. Nests retain admin/author restrictions; parents cannot add reactions from their read-only review. Scheduled previews offer their existing Edit, Reschedule and Cancel send actions. SMS preserves its existing supported delivery/retry controls. Neither unpublished drafts nor external SMS gains in-app emoji reactions.

A short tap still opens a link, attachment, poll, RSVP or assignment list. Holding an activity does not also open it on release; the focused view offers an Open action and supports opening the card itself. Moving more than 10 pixels, scrolling, releasing early, pointer cancellation, losing window focus or unmounting the message clears the pending hold. Native touch callouts are suppressed on the chat message; selected text can still be copied inside the focused view. Interactions inside an already-open activity dialog do not start message holds.

Desktop users may also right-click, or focus a message and press Enter, Space, Shift+F10 or the context-menu key. The view traps keyboard focus, closes with Escape/the close button/a tap outside, and restores focus. Opening the emoji picker and pressing Escape closes that picker first. The source app is `inert` while the view is open. Animation and background blur respect reduced-motion preferences.

The existing encrypted reaction provider is shared with the focused view through its portal. Reaction limits, membership/history restrictions, parental approval and unread/notification behavior are unchanged. Message sending, editing, scheduling and provider APIs are unchanged.

`e2e/message-focus.spec.js` verifies actual mouse and touch hold timing, the layout above/below the selected message, clean normal-chat rows, dismissal/focus restoration, short taps, movement/release/cancel behavior, editing and activity opening. The existing reaction, message editing, scheduling, SMS, workflow and encryption tests use the same keyboard-accessible action view.
