// 临时测试文件 - 为历史记录添加测试数据
// 在浏览器控制台运行以下代码来添加测试历史记录

const testHistory = [
    {
        vod_id: "12345",
        vod_name: "测试电视剧",
        vod_pic: "https://zj.qxyys.com/upload/vod/20250802-1/c08a90329f688e21ed677c458cf590ca.jpg",
        type_name: "电视剧",
        current_episode: 5,
        episode_name: "第5集",
        watch_time: Date.now() - 3600000, // 1小时前
        site_name: "测试站点",
        progress: 75
    },
    {
        vod_id: "67890",
        vod_name: "测试电影",
        vod_pic: "https://zj.qxyys.com/upload/vod/20250802-1/ff244c75a5a71451ec1b77dcdbd08868.jpg",
        type_name: "电影",
        current_episode: 1,
        episode_name: "正片",
        watch_time: Date.now() - 7200000, // 2小时前
        site_name: "测试站点2",
        progress: 50
    }
];

// 保存到localStorage
localStorage.setItem('play_history', JSON.stringify(testHistory));
console.log('测试历史记录已添加');

// 重新渲染历史页面
if (typeof app !== 'undefined' && app.showHistoryPage) {
    app.showHistoryPage();
    console.log('历史页面已刷新');
}
