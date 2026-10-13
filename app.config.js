const { expo } = require('./app.json');
module.exports = () => process.env.BILIPOP_QA === '1'
  ? { ...expo, name: 'BiliPop QA', scheme: 'bilipop-qa', android: { ...expo.android, package: 'app.bilipop.qa' } }
  : expo;
