// Sample posts shaped exactly like what the Facebook scraper returns.
// Used as a fallback so the UI works before you connect a real data source.
// Mix of renters (real leads), owners/sellers, agents, and noise.

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString()

export const mockPosts = [
  {
    id: 'p1',
    author: 'Nudee Rattana',
    authorUrl: 'https://facebook.com/100001',
    text: 'หาคอนโดเช่าแถวอโศก-พร้อมพงษ์ งบ 15,000-18,000 ห้อง 1 นอน เข้าอยู่ได้ต้นเดือนหน้า มีใครปล่อยเช่าบ้างทักมาได้เลยค่ะ โทร 081-234-5678',
    createdAt: minsAgo(8),
    permalink: 'https://facebook.com/groups/condoowner/posts/p1',
    group: 'condoowner',
  },
  {
    id: 'p2',
    author: 'Property Hub TH',
    authorUrl: 'https://facebook.com/100002',
    text: '🔥 ปล่อยเช่า The Base พระราม 9 ชั้นสูง วิวสวย 1 นอน 28 ตร.ม. เฟอร์ครบ 16,000/เดือน สนใจนัดชมห้องได้เลยครับ ทักแชทหรือโทร 089-999-0000',
    createdAt: minsAgo(15),
    permalink: 'https://facebook.com/groups/condoowner/posts/p2',
    group: 'condoowner',
  },
  {
    id: 'p3',
    author: 'Mild Chayanan',
    authorUrl: 'https://facebook.com/100003',
    text: 'มีใครรู้จักห้องเช่าใกล้ BTS อ่อนนุชไหมคะ อยากได้สตูดิโอ งบไม่เกินหมื่นห้า เลี้ยงแมวได้ยิ่งดี เข้าอยู่ได้เลยค่ะ',
    createdAt: minsAgo(22),
    permalink: 'https://facebook.com/groups/renthub/posts/p3',
    group: 'renthub',
  },
  {
    id: 'p4',
    author: 'สมชาย ขายดี',
    authorUrl: 'https://facebook.com/100004',
    text: 'ขายดาวน์ Ideo Mobi สุขุมวิท เจ้าของขายเอง ราคา 2.9 ล้าน ต่อรองได้ ใครสนใจลงทุนปล่อยเช่าทักเลย',
    createdAt: minsAgo(31),
    permalink: 'https://facebook.com/groups/owneronly/posts/p4',
    group: 'owneronly',
  },
  {
    id: 'p5',
    author: 'Ann Worawan',
    authorUrl: 'https://facebook.com/100005',
    text: 'รับโอนสิทธิ์เช่าด่วน ย้ายงานมาทำแถวสีลม อยากได้ห้องเช่าใกล้ MRT สามย่าน 1 ห้องนอน งบ 20,000 พร้อมเข้าอยู่ทันที รบกวนแอดมินช่วยแชร์ด้วยนะคะ',
    createdAt: minsAgo(44),
    permalink: 'https://facebook.com/groups/renthub/posts/p5',
    group: 'renthub',
  },
  {
    id: 'p6',
    author: 'Condo Investor Club',
    authorUrl: 'https://facebook.com/100006',
    text: 'สัมมนาฟรี! เทคนิคปล่อยเช่าคอนโดให้ได้ผลตอบแทน 8% ต่อปี สมัครเลยที่ลิงก์ในคอมเมนต์',
    createdAt: minsAgo(52),
    permalink: 'https://facebook.com/groups/175356699802854/posts/p6',
    group: '175356699802854',
  },
  {
    id: 'p7',
    author: 'Tonkla P.',
    authorUrl: 'https://facebook.com/100007',
    text: 'หาห้องพักให้น้องที่มาเรียน ม.กรุงเทพ รังสิต งบ 6,000-8,000 ขอใกล้มหาลัย เดินทางสะดวก ใครมีแนะนำได้เลยครับ ติดต่อ line: tonkla99',
    createdAt: minsAgo(58),
    permalink: 'https://facebook.com/groups/renthub/posts/p7',
    group: 'renthub',
  },
]
