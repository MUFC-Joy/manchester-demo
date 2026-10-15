/**
 * legends.js — 双雄传奇名录（"传奇墙"素材，方案附录 D）
 *
 * 注意（方案 §6.9 商标边界）：只显示姓名文字，不用头像/号码/队徽。
 * 曼联多于曼城，为作者取舍（这是曼彻斯特，红蓝都致敬）。
 * 动手前建议对照两队官网复核一遍。
 */

export const LEGENDS = {
  manUtd: {
    label: 'MANCHESTER UNITED',
    color: 0xff5a4a,
    tier1: [
      'Sir Bobby Charlton',
      'George Best',
      'Denis Law',
      'Eric Cantona',
      'Ryan Giggs',
      'Paul Scholes',
      'David Beckham',
      'Roy Keane',
      'Peter Schmeichel',
      'Wayne Rooney',
    ],
    tier2: [
      'Sir Alex Ferguson',
      'Sir Matt Busby',
      'Ole Gunnar Solskjær',
      'Bryan Robson',
      'Cristiano Ronaldo',
      'Denis Irwin',
      'Rio Ferdinand',
      'Nemanja Vidić',
      'Edwin van der Sar',
      'Andy Cole',
      'Jaap Stam',
      'Gary Neville',
      'Duncan Edwards',
    ],
  },
  manCity: {
    label: 'MANCHESTER CITY',
    color: 0x5aa9ff,
    tier1: [
      'Colin Bell',
      'Sergio Agüero',
      'David Silva',
      'Vincent Kompany',
      'Bert Trautmann',
    ],
    tier2: [
      'Kevin De Bruyne',
      'Yaya Touré',
      'Pep Guardiola',
      'Francis Lee',
      'Mike Summerbee',
    ],
  },
}
