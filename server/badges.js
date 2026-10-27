// A badge counts unread messages, not the capped notification-history list.
export function createBadges({db,family,encryptionRequired,smsUnread}){
 return {snapshot(uid){
  if(!family.ready(uid))return {count:0,nests:0,private:0,sms:0};
  const nests=db.prepare(`SELECT COALESCE(SUM(MAX(COALESCE(unread.n,0),gm.marked_unread)),0) AS n
   FROM group_members gm JOIN groups g ON g.id=gm.group_id
   JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=gm.user_id
   LEFT JOIN (SELECT m.group_id,COUNT(*) AS n FROM messages m JOIN group_members mine ON mine.group_id=m.group_id AND mine.user_id=?
    WHERE m.user_id<>? AND m.deleted=0 AND m.id>mine.last_read AND m.message_kind NOT IN ('poll_vote','rsvp_response','assignment_op')
    ${encryptionRequired?"AND m.e2ee_version=1 AND m.id>mine.joined_after AND EXISTS(SELECT 1 FROM e2ee_recipients er WHERE er.message_id=m.id AND er.user_id=mine.user_id)":''}
    GROUP BY m.group_id) unread ON unread.group_id=gm.group_id
   WHERE gm.user_id=? AND gm.muted=0`).get(uid,uid,uid).n;
  const conversations=db.prepare(`SELECT c.*,COUNT(m.id) AS unread FROM private_conversations c
   JOIN private_messages m ON m.conversation_id=c.id AND m.user_id<>? AND m.id>CASE WHEN c.user_low=? THEN c.read_low ELSE c.read_high END
   WHERE (c.user_low=? OR c.user_high=?) AND c.blocked_low=0 AND c.blocked_high=0 GROUP BY c.id`).all(uid,uid,uid,uid);
  const privateCount=conversations.filter(c=>family.pairAllowed(c.user_low,c.user_high)).reduce((n,c)=>n+c.unread,0);
  const sms=smsUnread(uid);
  return {count:nests+privateCount+sms,nests,private:privateCount,sms};
 }};
}
