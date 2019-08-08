var imageCache = {};

var Canvas = function (elemRef) {};
Canvas.getContext = function (id) {
    var ctx = document.getElementById(id).getContext('2d');
    ctx.test = function () {}
    ctx.draw = function (cb) {
        cb && cb();
    }
    ctx.setProjectionMatrix = function (){}
    ctx.glClearColor = function () {}
    ctx.glClear = function () {
        ctx.clearRect(0, 0, 375, 667);
    }
    ctx._drawImage = ctx.drawImage;
    ctx.drawImage = function (url) {
        var args = [].slice.call(arguments);
        if (imageCache[url]) {
            args[0] = imageCache[url];
            ctx._drawImage.apply(ctx, args);
        } else {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                imageCache[url] = img;
                args[0] = imageCache[url];
                ctx._drawImage.apply(ctx, args);
            };
            img.src = url;
        }
    }
    return ctx;
};
var imgsMap = {
    'anim/anim_brand_1_baili.png':{
        url: '//gw.alicdn.com/tfscom/TB171l_KXXXXXb9XXXXyZI3JVXX-146-159.png',
        width: 146,
        height: 159
    },
    'anim/anim_brand_1_baojie.png':{
        url: '//gw.alicdn.com/tfscom/TB1wVycKXXXXXXWXXXX9FwrFXXX-140-60.png',
        width: 140,
        height: 60
    },
    'anim/anim_brand_1_haier.png':{
        url: '//gw.alicdn.com/tfscom/TB16IdYKXXXXXXXXFXXeQ_2IXXX-143-108.png',
        width: 143,
        height: 108
    },
    'anim/anim_brand_1_huawei.png':{
        url: '//gw.alicdn.com/tfscom/TB1sPlLKXXXXXa0XVXXw82UVpXX-204-189.png',
        width: 204,
        height: 189
    },
    'anim/anim_brand_1_jieke.png':{
        url: '//gw.alicdn.com/tfscom/TB1mkJ8KXXXXXc7XXXX5i00LVXX-152-195.png',
        width: 152,
        height: 195
    },
    'anim/anim_brand_1_lining.png':{
        url: '//gw.alicdn.com/tfscom/TB1Mz08KXXXXXaXXpXX4bG28VXX-83-189.png',
        width: 83,
        height: 189
    },
    'anim/anim_brand_1_linshimuye.png':{
        url: '//gw.alicdn.com/tfscom/TB1xMxSKXXXXXaLXFXXjYqp1VXX-216-162.png',
        width: 216,
        height: 162
    },
    'anim/anim_brand_1_luolaijiafang.png':{
        url: '//gw.alicdn.com/tfscom/TB1HVp9KXXXXXbDXXXXcKs9GpXX-158-78.png',
        width: 158,
        height: 78
    },
    'anim/anim_brand_1_meidi.png':{
        url: '//gw.alicdn.com/tfscom/TB1NCSXKXXXXXaVXXXXJR4RZFXX-105-106.png',
        width: 105,
        height: 106
    },
    'anim/anim_brand_1_suning.png':{
        url: '//gw.alicdn.com/tfscom/TB1G.OtJVXXXXcOXpXXawpwSVXX-378-347.png',
        width: 378,
        height: 347
    },
    'anim/anim_brand_1_yashilandai.png':{
        url: '//gw.alicdn.com/tfscom/TB1upx4KXXXXXXGXpXXu6y9FXXX-136-80.png',
        width: 136,
        height: 80
    },
    'anim/anim_brand_1_zara.png':{
        url: '//gw.alicdn.com/tfscom/TB12HxRKXXXXXbDXFXXRrptMpXX-257-178.png',
        width: 257,
        height: 178
    },
    'anim/anim_brand_2_anta.png':{
        url: '//gw.alicdn.com/tfscom/TB1nUibKXXXXXX3XXXXfq_S9XXX-130-129.png',
        width: 130,
        height: 129
    },
    'anim/anim_brand_2_changanqiche.png':{
        url: '//gw.alicdn.com/tfscom/TB1J5CdKXXXXXaxXXXXP6NRLVXX-152-152.png',
        width: 152,
        height: 152
    },
    'anim/anim_brand_2_costco.png':{
        url: '//gw.alicdn.com/tfscom/TB14D0.KXXXXXbrXXXX.eDyJFXX-89-79.png',
        width: 89,
        height: 79
    },
    'anim/anim_brand_2_dafuni.png':{
        url: '//gw.alicdn.com/tfscom/TB1RP8TKXXXXXauXFXXIIrMHpXX-54-64.png',
        width: 54,
        height: 64
    },
    'anim/anim_brand_2_defu.png':{
        url: '//gw.alicdn.com/tfscom/TB1k1p3KXXXXXamXpXXTTuH.pXX-124-59.png',
        width: 124,
        height: 59
    },
    'anim/anim_brand_2_delsey.png':{
        url: '//gw.alicdn.com/tfscom/TB1.Mt3KXXXXXajXpXXYZNBIpXX-70-94.png',
        width: 70,
        height: 94
    },
    'anim/anim_brand_2_feilipu.png':{
        url: '//gw.alicdn.com/tfscom/TB1CmlGKXXXXXcEXVXX4lnv7FXX-78-103.png',
        width: 78,
        height: 103
    },
    'anim/anim_brand_2_fiveplus.png':{
        url: '//gw.alicdn.com/tfscom/TB10aBPKXXXXXXgXVXXMGaaJVXX-94-35.png',
        width: 94,
        height: 35
    },
    'anim/anim_brand_2_gap.png':{
        url: '//gw.alicdn.com/tfscom/TB15ix2KXXXXXbXXpXXEBl8JFXX-91-55.png',
        width: 91,
        height: 55
    },
    'anim/anim_brand_2_gujiajiajv.png':{
        url: '//gw.alicdn.com/tfscom/TB1rcVZKXXXXXXjXFXXP6NRLVXX-152-152.png',
        width: 152,
        height: 152
    },
    'anim/anim_brand_2_hailanzhijia.png':{
        url: '//gw.alicdn.com/tfscom/TB1OudPKXXXXXc_XFXXl3_uJFXX-89-61.png',
        width: 89,
        height: 61
    },
    'anim/anim_brand_2_haixin.png':{
        url: '//gw.alicdn.com/tfscom/TB1a40FKXXXXXXxXpXXnxJtIpXX-67-52.png',
        width: 67,
        height: 52
    },
    'anim/anim_brand_2_handuyishe.png':{
        url: '//gw.alicdn.com/tfscom/TB1empnKXXXXXcPXFXX2gGnHpXX-53-58.png',
        width: 53,
        height: 58
    },
    'anim/anim_brand_2_haoqi.png':{
        url: '//gw.alicdn.com/tfscom/TB1GHN9KXXXXXcsXXXXcgZpFXXX-137-48.png',
        width: 137,
        height: 48
    },
    'anim/anim_brand_2_laxiabeier.png':{
        url: '//gw.alicdn.com/tfscom/TB16BRUKXXXXXadXFXXXRnN9XXX-127-106.png',
        width: 127,
        height: 106
    },
    'anim/anim_brand_2_lianhelihua.png':{
        url: '//gw.alicdn.com/tfscom/TB1DHydKXXXXXXtXXXX2KYBJVXX-95-54.png',
        width: 95,
        height: 54
    },
    'anim/anim_brand_2_lianxiang.png':{
        url: '//gw.alicdn.com/tfscom/TB1PGBYKXXXXXc6XpXXZQ9AHFXX-56-88.png',
        width: 56,
        height: 88
    },
    'anim/anim_brand_2_mannifen.png':{
        url: '//gw.alicdn.com/tfscom/TB1_Bh3KXXXXXaNXpXXWb47_XXX-103-61.png',
        width: 103,
        height: 61
    },
    'anim/anim_brand_2_meizu.png':{
        url: '//gw.alicdn.com/tfscom/TB1YRBHKXXXXXXnXFXXksXbHVXX-61-36.png',
        width: 61,
        height: 36
    },
    'anim/anim_brand_2_oulaiya.png':{
        url: '//gw.alicdn.com/tfscom/TB1Ts8WKXXXXXXiXFXXPd34HXXX-49-71.png',
        width: 49,
        height: 71
    },
    'anim/anim_brand_2_oupuzhaoming.png':{
        url: '//gw.alicdn.com/tfscom/TB1EnJZKXXXXXcVXpXX97.QFVXX-152-71.png',
        width: 152,
        height: 71
    },
    'anim/anim_brand_2_qianbi.png':{
        url: '//gw.alicdn.com/tfscom/TB11gXJKXXXXXcXXXXXhhgoGXXX-34-17.png',
        width: 34,
        height: 17
    },
    'anim/anim_brand_2_quanyoujiajv.png':{
        url: '//gw.alicdn.com/tfscom/TB1JmBNKXXXXXbmXpXXGtgUJFXX-93-68.png',
        width: 93,
        height: 68
    },
    'anim/anim_brand_2_shihuakou.png':{
        url: '//gw.alicdn.com/tfscom/TB17Fh2KXXXXXbCXpXXdFzKKXXX-98-60.png',
        width: 98,
        height: 60
    },
    'anim/anim_brand_2_shuixingjiafang.png':{
        url: '//gw.alicdn.com/tfscom/TB1xEpNKXXXXXcLXFXXP6NRLVXX-152-152.png',
        width: 152,
        height: 152
    },
    'anim/anim_brand_2_tcl.png':{
        url: '//gw.alicdn.com/tfscom/TB1SNBWKXXXXXaPXFXXP6NRLVXX-152-152.png',
        width: 152,
        height: 152
    },
    'anim/anim_brand_2_xiaomi.png':{
        url: '//gw.alicdn.com/tfscom/TB1yH0DKXXXXXbpXFXXKEF.GVXX-44-66.png',
        width: 44,
        height: 66
    },
    'anim/anim_brand_2_zhoudafu.png':{
        url: '//gw.alicdn.com/tfscom/TB1M8lSKXXXXXbJXFXXrDKYIpXX-68-86.png',
        width: 68,
        height: 86
    },
    'anim/anim_country_aodaliya.png':{
        url: '//gw.alicdn.com/tfscom/TB1xf4yKXXXXXXiXFXXppEgIpXX-69-65.png',
        width: 69,
        height: 65
    },
    'anim/anim_country_deguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1HgB5KXXXXXasXpXXJSE5HXXX-52-77.png',
        width: 52,
        height: 77
    },
    'anim/anim_country_faguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1fHFZKXXXXXcSXpXXXpMd.FXX-128-70.png',
        width: 128,
        height: 70
    },
    'anim/anim_country_hanguo.png':{
        url: '//gw.alicdn.com/tfscom/TB18Zd1KXXXXXbeXpXXVtF2GFXX-38-56.png',
        width: 38,
        height: 56
    },
    'anim/anim_country_meiguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1x6pQKXXXXXcXXFXXnIBmHVXX-58-97.png',
        width: 58,
        height: 97
    },
    'anim/anim_country_riben.png':{
        url: '//gw.alicdn.com/tfscom/TB1VdNNKXXXXXb9XFXXBMVBIpXX-67-95.png',
        width: 67,
        height: 95
    },
    'anim/anim_country_taiguo.png':{
        url: '//gw.alicdn.com/tfscom/TB14jFjKXXXXXbMXVXX0ljnGFXX-39-61.png',
        width: 39,
        height: 61
    },
    'anim/anim_country_taiwan.png':{
        url: '//gw.alicdn.com/tfscom/TB1ed8SKXXXXXbsXFXXx57jIpXX-72-85.png',
        width: 72,
        height: 85
    },
    'anim/anim_country_xinxilan.png':{
        url: '//gw.alicdn.com/tfscom/TB1cb83KXXXXXbhXpXXyQZBFpXX-143-74.png',
        width: 143,
        height: 74
    },
    'anim/anim_country_yidali.png':{
        url: '//gw.alicdn.com/tfscom/TB1CXObKXXXXXajXXXXIIeZ.VXX-133-64.png',
        width: 133,
        height: 64
    },
    'anim/anim_country_yingguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1xU41KXXXXXbyXpXXJJBtIpXX-67-51.png',
        width: 67,
        height: 51
    },
    'anim/anim_entry_baihuo.png':{
        url: '//gw.alicdn.com/tfscom/TB1EKVQKXXXXXaTXFXX9FwrFXXX-137-57.png',
        width: 137,
        height: 57
    },
    'anim/anim_entry_center.png':{
        url: '//gw.alicdn.com/tfscom/TB15ToqKXXXXXaFXXXX5q5AKFXX-150-141.png',
        width: 150,
        height: 141
    },
    'anim/anim_entry_chaoshi.png':{
        url: '//gw.alicdn.com/tfscom/TB1UyJ5KXXXXXajXpXXLCaQ.FXX-127-66.png',
        width: 127,
        height: 66
    },
    'anim/anim_entry_dianqi.png':{
        url: '//gw.alicdn.com/tfscom/TB1.RxQKXXXXXb9XFXX6MrY.XXX-122-60.png',
        width: 122,
        height: 60
    },
    'anim/anim_entry_fushi.png':{
        url: '//gw.alicdn.com/tfscom/TB1l.B1KXXXXXbJXpXXCn3L_VXX-133-145.png',
        width: 133,
        height: 145
    },
    'anim/anim_entry_guoji.png':{
        url: '//gw.alicdn.com/tfscom/TB1CdRWKXXXXXXhXFXXxiJ19VXX-100-73.png',
        width: 100,
        height: 73
    },
    'anim/anim_entry_huabei.png':{
        url: '//gw.alicdn.com/tfscom/TB1Rb4ZKXXXXXc4XpXXlOLoJFXX-92-26.png',
        width: 92,
        height: 26
    },
    'anim/anim_entry_jiazhuang.png':{
        url: '//gw.alicdn.com/tfscom/TB1HHJ0KXXXXXbHXpXXVEecJFXX-91-95.png',
        width: 91,
        height: 95
    },
    'anim/anim_entry_qiche.png':{
        url: '//gw.alicdn.com/tfscom/TB1zlt1KXXXXXbdXpXXw8WwGVXX-165-51.png',
        width: 165,
        height: 51
    },
    'anim/anim_entry_qingdan.png':{
        url: '//gw.alicdn.com/tfscom/TB1fBNEKXXXXXXVXpXXPd34HXXX-52-68.png',
        width: 52,
        height: 68
    },
    'anim/anim_entry_qua.png':{
        url: '//gw.alicdn.com/tfscom/TB1szRNKXXXXXazXXXXYpNwIFXX-73-19.png',
        width: 73,
        height: 19
    },
    'anim/anim_entry_shishang.png':{
        url: '//gw.alicdn.com/tfscom/TB1dktHKXXXXXciXVXXszjdGpXX-137-137.png',
        width: 137,
        height: 137
    },
    'anim/anim_entry_yiyao.png':{
        url: '//gw.alicdn.com/tfscom/TB10qFmKXXXXXXWXVXXQtyQIXXX-65-90.png',
        width: 65,
        height: 90
    },
    'brand/brand_2_anta.png':{
        url: '//gw.alicdn.com/tfscom/TB1QjpVKXXXXXXMXFXXmEgRYXXX-210-254.png',
        width: 210,
        height: 254
    },
    'brand/brand_2_changanqiche.png':{
        url: '//gw.alicdn.com/tfscom/TB1Px0RKXXXXXcTXFXXpbZRYXXX-210-251.png',
        width: 210,
        height: 251
    },
    'brand/brand_2_costco.png':{
        url: '//gw.alicdn.com/tfscom/TB1MYacKXXXXXXZXXXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'brand/brand_2_dafuni.png':{
        url: '//gw.alicdn.com/tfscom/TB1yS0NKXXXXXaWXVXX8PIQYXXX-210-246.png',
        width: 210,
        height: 246
    },
    'brand/brand_2_defu.png':{
        url: '//gw.alicdn.com/tfscom/TB1rYkPJVXXXXaRXpXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'brand/brand_2_delsey.png':{
        url: '//gw.alicdn.com/tfscom/TB1UIx_KXXXXXcjXXXXuPkPYXXX-210-242.png',
        width: 210,
        height: 242
    },
    'brand/brand_2_feilipu.png':{
        url: '//gw.alicdn.com/tfscom/TB1tUoPJVXXXXanXpXX523RYXXX-210-252.png',
        width: 210,
        height: 252
    },
    'brand/brand_2_fiveplus.png':{
        url: '//gw.alicdn.com/tfscom/TB1PUdVKXXXXXXwXFXXLDQQYXXX-210-247.png',
        width: 210,
        height: 247
    },
    'brand/brand_2_gap.png':{
        url: '//gw.alicdn.com/tfscom/TB1zCFCKpXXXXXSXFXXxC3OYXXX-210-236.png',
        width: 210,
        height: 236
    },
    'brand/brand_2_gujiajiajv.png':{
        url: '//gw.alicdn.com/tfscom/TB1WHEyJVXXXXalXVXXxC3OYXXX-210-236.png',
        width: 210,
        height: 236
    },
    'brand/brand_2_hailanzhijia.png':{
        url: '//gw.alicdn.com/tfscom/TB1P10VKXXXXXX9XFXX523RYXXX-210-252.png',
        width: 210,
        height: 252
    },
    'brand/brand_2_haixin.png':{
        url: '//gw.alicdn.com/tfscom/TB1Io1bKXXXXXXUXXXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'brand/brand_2_handuyishe.png':{
        url: '//gw.alicdn.com/tfscom/TB1XPIYJVXXXXboXXXXuPkPYXXX-210-242.png',
        width: 210,
        height: 242
    },
    'brand/brand_2_haoqi.png':{
        url: '//gw.alicdn.com/tfscom/TB1xiVPKXXXXXcDXFXXC1oNYXXX-210-230.png',
        width: 210,
        height: 230
    },
    'brand/brand_2_laxiabeier.png':{
        url: '//gw.alicdn.com/tfscom/TB1JD0OKXXXXXcXXFXXpbZRYXXX-210-248.png',
        width: 210,
        height: 248
    },
    'brand/brand_2_lianhelihua.png':{
        url: '//gw.alicdn.com/tfscom/TB1O.t7KXXXXXXvXpXXIP.RYXXX-210-253.png',
        width: 210,
        height: 253
    },
    'brand/brand_2_lianxiang.png':{
        url: '//gw.alicdn.com/tfscom/TB1VGEDJVXXXXb8XFXXpbZRYXXX-210-251.png',
        width: 210,
        height: 251
    },
    'brand/brand_2_mannifen.png':{
        url: '//gw.alicdn.com/tfscom/TB1Pdd9KXXXXXcIXXXXIP.RYXXX-210-253.png',
        width: 210,
        height: 253
    },
    'brand/brand_2_meizu.png':{
        url: '//gw.alicdn.com/tfscom/TB1.GsFKXXXXXaWXFXXd1QOYXXX-210-234.png',
        width: 210,
        height: 234
    },
    'brand/brand_2_oulaiya.png':{
        url: '//gw.alicdn.com/tfscom/TB1d.cPJVXXXXarXpXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'brand/brand_2_oupuzhaoming.png':{
        url: '//gw.alicdn.com/tfscom/TB11W8IKpXXXXboXpXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'brand/brand_2_qianbi.png':{
        url: '//gw.alicdn.com/tfscom/TB1WoNAKpXXXXaXXFXXIP.RYXXX-210-253.png',
        width: 210,
        height: 253
    },
    'brand/brand_2_quanyoujiajv.png':{
        url: '//gw.alicdn.com/tfscom/TB1r1tOKXXXXXXvXVXXTOUOYXXX-210-235.png',
        width: 210,
        height: 235
    },
    'brand/brand_2_shihuakou.png':{
        url: '//gw.alicdn.com/tfscom/TB1Nm8NKXXXXXXvXVXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'brand/brand_2_shuixingjiafang.png':{
        url: '//gw.alicdn.com/tfscom/TB1cX0LKXXXXXX5XVXX3ckSYXXX-210-255.png',
        width: 210,
        height: 255
    },
    'brand/brand_2_tcl.png':{
        url: '//gw.alicdn.com/tfscom/TB1AmstJVXXXXbBXVXXr2EQYXXX-210-245.png',
        width: 210,
        height: 245
    },
    'brand/brand_2_xiaomi.png':{
        url: '//gw.alicdn.com/tfscom/TB1ORl_KXXXXXbLXXXXg3UTYXXX-210-263.png',
        width: 210,
        height: 263
    },
    'brand/brand_2_zhoudafu.png':{
        url: '//gw.alicdn.com/tfscom/TB1QLUFJVXXXXbaXFXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'map/101.png':{
        url: '//gw.alicdn.com/tfscom/TB1rMWDJVXXXXckXXXXBScZ7XXX-231-148.png',
        width: 231,
        height: 148
    },
    'map/102.png':{
        url: '//gw.alicdn.com/tfscom/TB1UNOhJVXXXXbBXVXXryUEYXXX-210-148.png',
        width: 210,
        height: 148
    },
    'map/brand_1_baili.png':{
        url: '//gw.alicdn.com/tfscom/TB1kCp3KXXXXXbNXpXXQ2cPYXXX-210-241.png',
        width: 210,
        height: 241
    },
    'map/brand_1_baojie.png':{
        url: '//gw.alicdn.com/tfscom/TB1X73PKXXXXXXmaXXXWCANYXXX-210-229.png',
        width: 210,
        height: 229
    },
    'map/brand_1_haier.png':{
        url: '//gw.alicdn.com/tfscom/TB18uN7KXXXXXXAXpXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'map/brand_1_huawei.png':{
        url: '//gw.alicdn.com/tfscom/TB1dQk2JVXXXXXJXXXXpbZRYXXX-210-248.png',
        width: 210,
        height: 248
    },
    'map/brand_1_jieke.png':{
        url: '//gw.alicdn.com/tfscom/TB1cjcGJVXXXXbcXFXXIP.RYXXX-210-253.png',
        width: 210,
        height: 253
    },
    'map/brand_1_lining.png':{
        url: '//gw.alicdn.com/tfscom/TB12QwSKXXXXXX5aXXXmEgRYXXX-210-254.png',
        width: 210,
        height: 254
    },
    'map/brand_1_linshimuye.png':{
        url: '//gw.alicdn.com/tfscom/TB113FQKXXXXXcjXFXXObwQYXXX-210-244.png',
        width: 210,
        height: 244
    },
    'map/brand_1_luolai.png':{
        url: '//gw.alicdn.com/tfscom/TB16oQzJVXXXXXdXVXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'map/brand_1_luolaijiafang.png':{
        url: '//gw.alicdn.com/tfscom/TB1de46KXXXXXbcXpXXF3sSYXXX-210-256.png',
        width: 210,
        height: 256
    },
    'map/brand_1_meidi.png':{
        url: '//gw.alicdn.com/tfscom/TB1lDoKJVXXXXcVXpXX523RYXXX-210-249.png',
        width: 210,
        height: 249
    },
    'map/brand_1_suning.png':{
        url: '//gw.alicdn.com/tfscom/TB1ghMHJVXXXXakXFXXVcunUVXX-203-255.png',
        width: 203,
        height: 255
    },
    'map/brand_1_yashilandai.png':{
        url: '//gw.alicdn.com/tfscom/TB1VD7zJVXXXXXxXVXXLDQQYXXX-210-247.png',
        width: 210,
        height: 247
    },
    'map/brand_1_zara.png':{
        url: '//gw.alicdn.com/tfscom/TB1vlMAJVXXXXc.XFXXLDQQYXXX-210-247.png',
        width: 210,
        height: 247
    },
    'map/brand_2_0.png':{
        url: '//gw.alicdn.com/tfscom/TB1WaFLKXXXXXbfXVXXObwQYXXX-210-244.png',
        width: 210,
        height: 244
    },
    'map/brand_3_1.png':{
        url: '//gw.alicdn.com/tfscom/TB1YPWXKXXXXXchXXXXo0ALYXXX-210-186.png',
        width: 210,
        height: 186
    },
    'map/brand_3_2.png':{
        url: '//gw.alicdn.com/tfscom/TB1tAlKKXXXXXcvXVXXo0ALYXXX-210-186.png',
        width: 210,
        height: 186
    },
    'map/brand_3_3.png':{
        url: '//gw.alicdn.com/tfscom/TB1TvUZJVXXXXcpXXXXLXsLYXXX-210-185.png',
        width: 210,
        height: 185
    },
    'map/brand_4_1.png':{
        url: '//gw.alicdn.com/tfscom/TB1AcKbKXXXXXaqXXXXo0ALYXXX-210-186.png',
        width: 210,
        height: 186
    },
    'map/brand_4_2.png':{
        url: '//gw.alicdn.com/tfscom/TB1g8ZMJVXXXXbNXpXXo0ALYXXX-210-186.png',
        width: 210,
        height: 186
    },
    'map/country_aodaliya.png':{
        url: '//gw.alicdn.com/tfscom/TB1iKX4KXXXXXaKXpXXNZ.KYXXX-210-209.png',
        width: 210,
        height: 209
    },
    'map/country_deguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1zCd9KXXXXXckXXXX5NELYXXX-210-220.png',
        width: 210,
        height: 220
    },
    'map/country_faguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1psX0KXXXXXciXpXX5NELYXXX-210-217.png',
        width: 210,
        height: 217
    },
    'map/country_hanguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1NR01KXXXXXbGXpXX5NELYXXX-210-217.png',
        width: 210,
        height: 217
    },
    'map/country_meiguo.png':{
        url: '//gw.alicdn.com/tfscom/TB114XUKXXXXXXWXFXXTOUOYXXX-210-235.png',
        width: 210,
        height: 235
    },
    'map/country_riben.png':{
        url: '//gw.alicdn.com/tfscom/TB125l2KXXXXXbbXpXXFN7MYXXX-210-224.png',
        width: 210,
        height: 224
    },
    'map/country_taiguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1dv0SKXXXXXbnXFXXIBMLYXXX-210-221.png',
        width: 210,
        height: 221
    },
    'map/country_taiwan.png':{
        url: '//gw.alicdn.com/tfscom/TB1RVR1KXXXXXb3XpXX5NELYXXX-210-220.png',
        width: 210,
        height: 220
    },
    'map/country_xinxilan.png':{
        url: '//gw.alicdn.com/tfscom/TB1DlF6KXXXXXc8XXXX20ZMYXXX-210-223.png',
        width: 210,
        height: 223
    },
    'map/country_yidali.png':{
        url: '//gw.alicdn.com/tfscom/TB1RMtCKXXXXXbkaXXXFN7MYXXX-210-224.png',
        width: 210,
        height: 224
    },
    'map/country_yingguo.png':{
        url: '//gw.alicdn.com/tfscom/TB1GaRPKXXXXXcrXFXXFN7MYXXX-210-224.png',
        width: 210,
        height: 224
    },
    'map/entry_baihuo.png':{
        url: '//gw.alicdn.com/tfscom/TB15g4qKpXXXXbYXVXXQrm6WpXX-420-253.png',
        width: 420,
        height: 253
    },
    'map/entry_center.png':{
        url: '//gw.alicdn.com/tfscom/TB1.MZoKXXXXXb1XXXXKQYsGXXX-351-343.png',
        width: 351,
        height: 343
    },
    'map/entry_chaoshi.png':{
        url: '//gw.alicdn.com/tfscom/TB1ti7DJVXXXXbPXFXXNTG6WpXX-420-256.png',
        width: 420,
        height: 256
    },
    'map/entry_dianqi.png':{
        url: '//gw.alicdn.com/tfscom/TB1hGUJJVXXXXX3XFXXNTG6WpXX-420-256.png',
        width: 420,
        height: 256
    },
    'map/entry_fushi.png':{
        url: '//gw.alicdn.com/tfscom/TB1MEA2JVXXXXXGXXXXNTG6WpXX-420-256.png',
        width: 420,
        height: 256
    },
    'map/entry_guoji.png':{
        url: '//gw.alicdn.com/tfscom/TB1A871JVXXXXadXXXXV5K4WpXX-420-244.png',
        width: 420,
        height: 244
    },
    'map/entry_huabei.png':{
        url: '//gw.alicdn.com/tfscom/TB1wzEqJVXXXXaiaXXXss7yHpXX-246-196.png',
        width: 246,
        height: 196
    },
    'map/entry_jiazhuang.png':{
        url: '//gw.alicdn.com/tfscom/TB1pQ3HJVXXXXavXFXXTe55WpXX-420-250.png',
        width: 420,
        height: 250
    },
    'map/entry_meizhuang.png':{
        url: '//gw.alicdn.com/tfscom/TB1imF.KXXXXXcAXXXXNTG6WpXX-420-256.png',
        width: 420,
        height: 256
    },
    'map/entry_qiche.png':{
        url: '//gw.alicdn.com/tfscom/TB1IUsIJVXXXXXVXFXXw6a5WpXX-420-248.png',
        width: 420,
        height: 248
    },
    'map/entry_qingdan.png':{
        url: '//gw.alicdn.com/tfscom/TB17No3JVXXXXXoXXXXNTG6WpXX-420-256.png',
        width: 420,
        height: 256
    },
    'map/entry_qua.png':{
        url: '//gw.alicdn.com/tfscom/TB1ATseJVXXXXakXVXXQMQJYXXX-210-176.png',
        width: 210,
        height: 176
    },
    'map/entry_shishang.png':{
        url: '//gw.alicdn.com/tfscom/TB1M.RPKpXXXXaqXXXXNTG6WpXX-420-256.png',
        width: 420,
        height: 256
    },
    'map/entry_wangting.png':{
        url: '//gw.alicdn.com/tfscom/TB1VLt_KXXXXXXcXpXXt390WpXX-420-222.png',
        width: 420,
        height: 222
    },
    'map/entry_yiyao.png':{
        url: '//gw.alicdn.com/tfscom/TB1kkZGJVXXXXcwXpXXNTG6WpXX-420-256.png',
        width: 420,
        height: 256
    },
    'map/map_LV3_YELLOW.png':{
        url: '//gw.alicdn.com/tfscom/TB1HeILJVXXXXckXpXX_WEEYXXX-210-146.png',
        width: 210,
        height: 146
    },
    'map/map_LV4_5.png':{
        url: '//gw.alicdn.com/tfscom/TB1pRo0JVXXXXaIXXXX_WEEYXXX-210-146.png',
        width: 210,
        height: 146
    },
    'map/map_LV4_C.png':{
        url: '//gw.alicdn.com/tfscom/TB1kHANJVXXXXbBXpXXo0ALYXXX-210-186.png',
        width: 210,
        height: 186
    },
    'map/map_Lv1_A.png':{
        url: '//gw.alicdn.com/tfscom/TB1Pp7NJVXXXXbHXpXXrNgKYXXX-210-183.png',
        width: 210,
        height: 183
    },
    'map/map_Lv1_B.png':{
        url: '//gw.alicdn.com/tfscom/TB1p1QZJVXXXXbkXXXXrNgKYXXX-210-183.png',
        width: 210,
        height: 183
    },
    'map/map_Lv1_C.png':{
        url: '//gw.alicdn.com/tfscom/TB1VB3wJVXXXXa0XVXXrNgKYXXX-210-183.png',
        width: 210,
        height: 183
    },
    'map/map_Lv1_D.png':{
        url: '//gw.alicdn.com/tfscom/TB13xASJVXXXXXcXpXXrNgKYXXX-210-183.png',
        width: 210,
        height: 183
    },
    'map/map_Lv1_E.png':{
        url: '//gw.alicdn.com/tfscom/TB1FXP0KXXXXXX8aXXXNZ.KYXXX-210-209.png',
        width: 210,
        height: 209
    },
    'map/map_Lv1_F.png':{
        url: '//gw.alicdn.com/tfscom/TB1hgEAJVXXXXXkXVXX5zgFYXXX-210-155.png',
        width: 210,
        height: 155
    },
    'map/map_Lv1_PC.png':{
        url: '//gw.alicdn.com/tfscom/TB1G8sGJVXXXXXMXpXXTAwIYXXX-210-203.png',
        width: 210,
        height: 203
    },
    'map/map_Lv1_floor.png':{
        url: '//gw.alicdn.com/tfscom/TB1k9M3JVXXXXaoXXXXrNgKYXXX-210-183.png',
        width: 210,
        height: 183
    },
    'map/map_Lv2.png':{
        url: '//gw.alicdn.com/tfscom/TB1iVkLJVXXXXcbXpXX_WEEYXXX-210-146.png',
        width: 210,
        height: 146
    },
    'map/map_Lv2_A.png':{
        url: '//gw.alicdn.com/tfscom/TB1fBwNJVXXXXbwXpXX20ZMYXXX-210-193.png',
        width: 210,
        height: 193
    },
    'map/map_Lv2_B.png':{
        url: '//gw.alicdn.com/tfscom/TB16egxJVXXXXacXVXXTAwIYXXX-210-173.png',
        width: 210,
        height: 173
    },
    'map/map_Lv2_C.png':{
        url: '//gw.alicdn.com/tfscom/TB1WPAJJVXXXXbKXpXXNZ.KYXXX-210-179.png',
        width: 210,
        height: 179
    },
    'map/map_Lv2_D.png':{
        url: '//gw.alicdn.com/tfscom/TB1RbZDJVXXXXbIXFXX5NELYXXX-210-187.png',
        width: 210,
        height: 187
    },
    'map/map_Lv2_F.png':{
        url: '//gw.alicdn.com/tfscom/TB1DZMNJVXXXXbrXpXXoLcFYXXX-210-154.png',
        width: 210,
        height: 154
    },
    'map/map_Lv2_G_PC.png':{
        url: '//gw.alicdn.com/tfscom/TB1pBUDJVXXXXb9XFXXzZkIYXXX-210-171.png',
        width: 210,
        height: 171
    },
    'map/map_Lv2_J.png':{
        url: '//gw.alicdn.com/tfscom/TB1z2ZIJVXXXXajXFXXLXsLYXXX-210-185.png',
        width: 210,
        height: 185
    },
    'map/map_Lv2_K_PC.png':{
        url: '//gw.alicdn.com/tfscom/TB1sTEKJVXXXXblXpXXNKMEYXXX-210-150.png',
        width: 210,
        height: 150
    },
    'map/map_Lv2_L.png':{
        url: '//gw.alicdn.com/tfscom/TB19IcyJVXXXXc7XFXXaZMJYXXX-210-175.png',
        width: 210,
        height: 175
    },
    'map/map_Lv2_M.png':{
        url: '//gw.alicdn.com/tfscom/TB1StUGJVXXXXa0XFXXTAwIYXXX-210-173.png',
        width: 210,
        height: 173
    },
    'map/map_Lv2_N.png':{
        url: '//gw.alicdn.com/tfscom/TB1VhwMJVXXXXb6XpXXuAZJYXXX-210-180.png',
        width: 210,
        height: 180
    },
    'map/map_Lv2_O_PC.png':{
        url: '//gw.alicdn.com/tfscom/TB1SX.vJVXXXXaaXVXXWocHYXXX-210-200.png',
        width: 210,
        height: 200
    },
    'map/map_Lv2_P_PC.png':{
        url: '//gw.alicdn.com/tfscom/TB1j8ZZJVXXXXatXXXXWocHYXXX-210-200.png',
        width: 210,
        height: 200
    },
    'map/map_Lv3_A.png':{
        url: '//gw.alicdn.com/tfscom/TB18v3RJVXXXXXYXpXXrNgKYXXX-210-183.png',
        width: 210,
        height: 183
    },
    'map/map_Lv3_B.png':{
        url: '//gw.alicdn.com/tfscom/TB1KW.zJVXXXXXOXVXXlYwGYXXX-210-157.png',
        width: 210,
        height: 157
    },
    'map/map_Lv3_E.png':{
        url: '//gw.alicdn.com/tfscom/TB15bENJVXXXXbFXpXX.o3JYXXX-210-181.png',
        width: 210,
        height: 181
    },
    'map/map_Lv3_F.png':{
        url: '//gw.alicdn.com/tfscom/TB1mPUBJVXXXXcAXFXXTAwIYXXX-210-203.png',
        width: 210,
        height: 203
    },
    'map/map_Lv3_G.png':{
        url: '//gw.alicdn.com/tfscom/TB10TsBJVXXXXc4XFXXumADYXXX-210-145.png',
        width: 210,
        height: 145
    },
    'map/map_Lv3_H.png':{
        url: '//gw.alicdn.com/tfscom/TB1t5EyJVXXXXaoXVXXTAwIYXXX-210-173.png',
        width: 210,
        height: 173
    },
    'map/map_Lv3_K.png':{
        url: '//gw.alicdn.com/tfscom/TB1o4AIJVXXXXX9XFXX5zgFYXXX-210-155.png',
        width: 210,
        height: 155
    },
    'map/map_Lv3_L.png':{
        url: '//gw.alicdn.com/tfscom/TB1pasvJVXXXXclXVXXlYwGYXXX-210-160.png',
        width: 210,
        height: 160
    },
    'map/map_Lv4_A.png':{
        url: '//gw.alicdn.com/tfscom/TB1KX73JVXXXXXFXXXX5NELYXXX-210-220.png',
        width: 210,
        height: 220
    },
    'map/map_Lv4_B.png':{
        url: '//gw.alicdn.com/tfscom/TB1ulESJVXXXXcfXXXXjnQGYXXX-210-163.png',
        width: 210,
        height: 163
    },
    'map/map_Lv4_D.png':{
        url: '//gw.alicdn.com/tfscom/TB1IVkPJVXXXXanXpXXdMsIYXXX-210-169.png',
        width: 210,
        height: 169
    },
    'map/map_Lv4_F.png':{
        url: '//gw.alicdn.com/tfscom/TB1GtMFJVXXXXbGXFXXWocHYXXX-210-200.png',
        width: 210,
        height: 200
    },
    'map/map_Lv4_G.png':{
        url: '//gw.alicdn.com/tfscom/TB1aagTJVXXXXceXXXXoLcFYXXX-210-154.png',
        width: 210,
        height: 154
    },
    'map/map_Lv4_H.png':{
        url: '//gw.alicdn.com/tfscom/TB1p2kEJVXXXXbFXFXX.o3JYXXX-210-181.png',
        width: 210,
        height: 181
    }
};

var mapData = [
    [0,0,0,0,0],
    [0,'102',0,0,0],
    [0,'101',0,0,0],
    [0,'102','map_Lv4_B','brand_4_1',0],
    [0,'map_Lv4_H','102','map_LV4_5','map_LV4_5'],
    [0,'brand_4_2','102','map_Lv4_F',0],
    ['map_LV4_5',0,'102','brand_4_1','map_LV4_5'],
    ['brand_4_1','102',0,'map_LV4_C',0],
    ['map_LV4_5','map_LV4_5','102','brand_4_2',0],
    ['brand_4_2','brand_4_1','102',0,0],
    ['map_LV4_5','map_Lv4_D','102',0,'map_LV4_5'],
    ['map_Lv4_H','map_LV4_5','102','brand_4_1',0],
    [0,'brand_4_2','102','map_Lv4_G','map_LV4_5'],
    [0,'102',0,'brand_4_2',0],
    ['map_LV4_5','102','map_Lv4_A',0,0],
    ['brand_4_1','101',0,0,0],
    ['map_LV4_5','map_Lv4_F','102','brand_4_1','map_LV4_5'],
    ['map_Lv4_D','102','map_Lv4_G','map_LV4_C',0],
    ['map_LV4_5','brand_4_2','102','brand_4_2','map_LV4_5'],
    ['map_LV4_5','102',0,'map_Lv4_B',0],
    [0,'brand_4_1','102','map_LV4_5','map_LV4_5'],
    [0,'102','map_Lv4_H','brand_4_1',0],
    ['map_LV4_5','101',0,'map_LV4_5','map_LV4_5'],
    ['brand_4_2','102','brand_4_1','brand_4_2',0],
    ['map_LV4_5','101',0,'map_Lv4_D','map_LV4_5'],
    ['brand_4_1','102','brand_4_2','brand_4_1',0],
    ['map_LV4_5','map_Lv4_G','102','map_Lv4_G','map_LV4_5'],
    ['brand_4_2','map_LV4_5','102','map_Lv4_F',0],
    ['map_LV4_5','map_Lv4_D','102',0,0],
    ['brand_4_1','102','map_Lv4_A',0,0],
    ['map_LV4_5','map_Lv4_H','102',0,'map_LV4_5'],
    [0,'101',0,'brand_4_2',0],
    [0,'101',0,'map_Lv4_B','map_LV4_5'],
    ['brand_4_2','102','map_LV4_5','map_Lv4_G',0],
    ['map_Lv4_G','101',0,'brand_4_1','map_LV4_5'],
    ['map_Lv2','102','map_LV4_C','map_Lv2',0],
    ['map_Lv2','102','brand_4_2','map_Lv2','map_Lv2_N'],
    ['map_Lv2_N','102','map_Lv2_D','map_Lv2_L',0],
    ['map_LV3_YELLOW','map_Lv3_L','102','map_Lv2','map_Lv2_P_PC'],
    ['brand_3_1','brand_3_1','102','map_Lv3_G',0],
    ['map_LV3_YELLOW','map_Lv3_F','101',0,'map_LV3_YELLOW'],
    ['brand_3_1','brand_3_1','102','brand_3_2',0],
    ['map_Lv2','map_Lv3_F','101',0,0],
    ['map_Lv2','map_LV3_YELLOW','102',0,0],
    ['entry_yiyao',0,'102','brand_3_3','map_LV3_YELLOW'],
    ['map_Lv2_L',0,'102','map_Lv3_A',0],
    [0,0,'map_Lv3_H','102','map_LV3_YELLOW'],
    ['brand_3_3','map_Lv3_L','102','brand_3_3',0],
    [0,'map_LV3_YELLOW','brand_3_2','102','map_LV3_YELLOW'],
    ['brand_3_3','map_Lv3_B','map_Lv3_F','102',0],
    [0,0,'brand_3_2','brand_3_2','102'],
    ['map_Lv3_E','map_LV3_YELLOW',0,'102',0],
    ['entry_wangting',0,'102',0,'map_LV3_YELLOW'],
    ['map_Lv3_G','102','brand_3_1','brand_3_1',0],
    [0,'102','map_Lv3_K','map_Lv3_F','map_LV3_YELLOW'],
    ['brand_3_3','102','map_Lv3_A','brand_3_1',0],
    ['map_LV3_YELLOW','102',0,'map_LV3_YELLOW','map_LV3_YELLOW'],
    ['102','brand_3_2','map_LV3_YELLOW','map_LV3_YELLOW',0],
    [0,'102','map_Lv2','entry_chaoshi',0],
    ['102','map_Lv2_L','map_Lv2_N','map_Lv2',0],
    ['102','brand_3_2','map_Lv3_A','map_Lv3_L',0],
    ['102','map_Lv3_B','map_LV3_YELLOW','brand_3_3',0],
    ['map_LV4_5','102','brand_3_1',0,0],
    ['brand_3_3','102','map_Lv3_L',0,0],
    ['map_Lv2_N','102','brand_3_1','map_Lv3_E',0],
    [0,'102',0,0,0],
    ['entry_qiche',0,'102','map_LV3_YELLOW','map_Lv3_L'],
    ['map_Lv2','102','brand_3_2','brand_3_2',0],
    ['map_Lv2_D','brand_3_3','102','map_Lv3_F','map_LV3_YELLOW'],
    ['map_Lv3_H','102','brand_3_2','brand_3_2',0],
    [0,'102','map_Lv3_B',0,0],
    ['brand_3_1','102',0,0,0],
    ['map_Lv2','map_Lv2_M','102','entry_jiazhuang',0],
    ['map_Lv2_F','map_Lv2','102','map_Lv2',0],
    ['map_Lv2_F',0,'102','map_Lv2_J','map_Lv2_F'],
    ['map_Lv2_M','102','map_Lv2_N','map_Lv2',0],
    ['map_Lv2','map_Lv2','102',0,'map_Lv1_floor'],
    [0,0,'102',0,0],
    ['map_Lv2','map_Lv2_L','102','map_Lv2_F','map_Lv2'],
    ['map_Lv2_N','map_Lv2_M','102',0,0],
    ['map_Lv2','map_Lv2',0,'102','map_Lv2'],
    [0,'map_Lv2_B','101',0,0],
    ['map_Lv2','map_Lv2','map_Lv2_N','101',0],
    ['map_Lv2','map_Lv2','country_aodaliya','102',0],
    ['entry_baihuo',0,'map_Lv2_C','102','map_Lv2'],
    ['map_Lv2','map_Lv2','102','map_Lv2_D',0],
    ['map_Lv2','map_Lv2','102','map_Lv2','map_Lv2_M'],
    [0,0,'102','map_Lv2',0],
    ['map_Lv2','map_Lv2_M','102','entry_shishang',0],
    ['map_Lv2_N','102','map_Lv2','map_Lv2',0],
    ['map_Lv2','102','map_Lv2_M','map_Lv2_L','map_Lv2'],
    [0,'102','country_aodaliya','map_Lv2_J',0],
    ['map_Lv2','map_Lv2','102','map_Lv2','map_Lv2'],
    ['map_Lv2_M','map_Lv2_B','102',0,0],
    ['map_Lv2',0,'102','map_Lv2_A','map_Lv2'],
    ['map_Lv2_N','102','map_Lv2','map_Lv2',0],
    ['map_Lv2','map_Lv2','102','entry_dianqi',0],
    [0,'map_Lv2_D','102','map_Lv2',0],
    ['map_Lv2','map_Lv2_K_PC','map_Lv2','102','map_Lv2'],
    ['map_Lv2_F',0,'102',0,0],
    ['map_Lv2','map_Lv2_M','102','map_Lv2_M','map_Lv2'],
    ['map_Lv2','102','country_aodaliya','map_Lv2_L',0],
    ['entry_meizhuang',0,'102','map_Lv2','map_Lv2'],
    ['map_Lv2','102','map_Lv2_C',0,0],
    ['map_Lv2_B',0,'102','map_Lv2_N','map_Lv2'],
    ['map_Lv2','102','map_Lv2_F','map_Lv2_M',0],
    ['map_Lv2_N',0,'102',0,'map_Lv2'],
    ['map_Lv2_M','map_Lv2_J','102','map_Lv2_F',0],
    ['map_Lv2','map_Lv2','map_Lv2','102','map_Lv2'],
    [0,'country_aodaliya','102',0,0],
    ['map_Lv2','map_Lv2','102','map_Lv2_F','map_Lv2'],
    ['map_Lv2','102','map_Lv2','map_Lv2_N',0],
    ['entry_fushi',0,'102',0,'map_Lv2'],
    ['map_Lv2','102','map_Lv2_L','map_Lv2_M',0],
    ['map_Lv2','map_Lv2_N','102','map_Lv2','map_Lv2'],
    [0,'102',0,0,0],
    ['map_Lv2','map_Lv2_M','102','map_Lv2_M','map_Lv2'],
    ['map_Lv2',0,'102','map_Lv2',0],
    ['map_Lv2','map_Lv2','102','entry_guoji',0],
    [0,'102','map_Lv2','map_Lv2',0],
    ['map_Lv2','map_Lv2_L','102','map_Lv2_F','map_Lv2'],
    ['map_Lv2_M','101',0,0,0],
    ['map_Lv2_F',0,'101',0,'map_Lv1_floor'],
    ['map_Lv1_floor','101',0,'map_Lv1_C','map_Lv1_floor'],
    ['map_Lv1_A',0,'102','map_Lv1_floor','map_Lv1_floor'],
    ['map_Lv1_floor','102','map_Lv1_D','map_Lv1_B',0],
    ['map_Lv1_floor','102','map_Lv1_floor','map_Lv1_floor','map_Lv1_floor'],
    ['brand_1_linshimuye','102','brand_1_yashilandai','map_Lv1_D',0],
    ['map_Lv1_floor','map_Lv1_F','102','map_Lv1_floor','map_Lv1_floor'],
    ['map_Lv1_floor','101',0,'brand_1_meidi',0],
    ['map_Lv1_D','brand_1_baili','102','map_Lv1_B','map_Lv1_floor'],
    ['map_Lv1_floor','102','brand_1_zara','map_Lv1_F',0],
    ['map_Lv1_floor',0,'102','map_Lv1_floor','map_Lv1_floor'],
    ['brand_1_baojie','brand_1_lining','102','brand_1_haier',0],
    [0,0,0,'102',0],
    ['map_Lv1_E',0,'entry_center','102',0],
    ['map_Lv1_floor',0,0,'102','map_Lv1_floor'],
    ['brand_1_huawei',0,'102','brand_1_jieke',0],
    [0,'map_Lv1_floor','102','map_Lv1_A','map_Lv1_floor'],
    ['map_Lv1_A','brand_1_luolaijiafang','102','map_Lv1_floor',0],
    ['map_Lv1_floor',0,'101',0,'map_Lv1_floor']
];

var animConfig = {
    'anim_brand_1_baili': {
        'col': 1,
        'row': 3,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 10.70506300502909,
        'y': 69.32096117986111
    },
    'anim_brand_1_baojie': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 4.3921568627451,
        'y': 54.25490196078408
    },
    'anim_brand_1_haier': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 25.654901960784343,
        'y': 38.98039215686276
    },
    'anim_brand_1_huawei': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 35.76692677070829,
        'y': 41.90516206482698
    },
    'anim_brand_1_jieke': {
        'col': 1,
        'row': 3,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 6.305662264906005,
        'y': 51.15172068827542
    },
    'anim_brand_1_lining': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 31.59519408842698,
        'y': 61.82046204955623
    },
    'anim_brand_1_linshimuye': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 29.15420692772784,
        'y': 59.67463411877816
    },
    'anim_brand_1_luolaijiafang': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 41.468976030749246,
        'y': 41.44609608497194
    },
    'anim_brand_1_meidi': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 9.830392156862786,
        'y': 60.24117647058756
    },
    'anim_brand_1_yashilandai': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 21.411764705882348,
        'y': 48.31372549019579
    },
    'anim_brand_1_zara': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 13.725490196078454,
        'y': 20.86274509803934
    },
    'anim_brand_2_anta': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 71.41086462416001,
        'y': 68.42619574887931
    },
    'anim_brand_2_changanqiche': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 14.15047773317741,
        'y': 40.97056727972449
    },
    'anim_brand_2_costco': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 21.191840676049083,
        'y': 45.331211788178734
    },
    'anim_brand_2_dafuni': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 57.90953895071539,
        'y': 56.57408585055691
    },
    'anim_brand_2_defu': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 17.178219395866563,
        'y': 69.6939586645467
    },
    'anim_brand_2_delsey': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 20.466735966735996,
        'y': 63.442827442827365
    },
    'anim_brand_2_feilipu': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 64.20373608903026,
        'y': 44.15341812400675
    },
    'anim_brand_2_fiveplus': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 45.07154213036563,
        'y': 20.197138314784752
    },
    'anim_brand_2_gap': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 56.258346581876026,
        'y': 60.314705882357885
    },
    'anim_brand_2_gujiajiajv': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 33.81496176630941,
        'y': 8.998433083023883
    },
    'anim_brand_2_hailanzhijia': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 71.29650238473766,
        'y': 21.288553259140826
    },
    'anim_brand_2_haixin': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 42.31717011128774,
        'y': 72.13259141494655
    },
    'anim_brand_2_handuyishe': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 34.47138314785377,
        'y': 74.70190779014229
    },
    'anim_brand_2_haoqi': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 50.246422893481736,
        'y': 55.92209856915724
    },
    'anim_brand_2_laxiabeier': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 30.560729273338495,
        'y': 49.36951162253081
    },
    'anim_brand_2_lianhelihua': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 51.363010068892436,
        'y': 40.901960784313815
    },
    'anim_brand_2_lianxiang': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 25.03974562798095,
        'y': 30.46502384737687
    },
    'anim_brand_2_mannifen': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 35.13104368288657,
        'y': 39.87134874595904
    },
    'anim_brand_2_meizu': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 39.623105458399436,
        'y': 33.021091679915116
    },
    'anim_brand_2_oulaiya': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 43.05222575516689,
        'y': 51.01613672496023
    },
    'anim_brand_2_oupuzhaoming': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 19.179809220985724,
        'y': 48.327503974563115
    },
    'anim_brand_2_qianbi': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': false,
        'x': 52.19607843137254,
        'y': 40.07843137254895
    },
    'anim_brand_2_quanyoujiajv': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 31.94224635207331,
        'y': 37.45361389691698
    },
    'anim_brand_2_shihuakou': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 79.45945945945948,
        'y': 16.28682075740926
    },
    'anim_brand_2_shuixingjiafang': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': -0.2559618441971452,
        'y': 53.67223105458379
    },
    'anim_brand_2_tcl': {
        'col': 2,
        'row': 2,
        'frame': '0,1,2',
        'useAnim': true,
        'x': 29.576687016482822,
        'y': 34.47951695251686
    },
    'anim_brand_2_xiaomi': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 13.88192898781134,
        'y': 47.05082140964441
    },
    'anim_brand_2_zhoudafu': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 35.300415800415806,
        'y': 44.332224532225155
    },
    'anim_country_aodaliya': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 74.86883942766292,
        'y': 16.275834658187705
    },
    'anim_country_deguo': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 79.29061784897027,
        'y': 25.22883295194515
    },
    'anim_country_faguo': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 48.89376447114307,
        'y': 38.13619679687599
    },
    'anim_country_hanguo': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 59.51341213661652,
        'y': 36.430022118574016
    },
    'anim_country_meiguo': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 47.10927152317879,
        'y': 22.447019867549898
    },
    'anim_country_riben': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 40.486270022883275,
        'y': 14.176201372997639
    },
    'anim_country_taiguo': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 44.83409610983978,
        'y': 66.07551487414185
    },
    'anim_country_taiwan': {
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 30.047694753577105,
        'y': 66.1049284578703
    },
    'anim_country_xinxilan': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 24.771167048054906,
        'y': 35.68077803203687
    },
    'anim_country_yidali': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 31.793462556647313,
        'y': 17.25793960604824
    },
    'anim_country_yingguo': {
        'col': 2,
        'row': 1,
        'frame': '0,1',
        'useAnim': true,
        'x': 35.9244851258581,
        'y': 26.53089244851253
    },
    'anim_entry_center': {
        'loop': true,
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 65,
        'y': 54.238118860032046
    },
    'anim_entry_center': {
        'loop': true,
        'col': 1,
        'row': 2,
        'frame': '0,1',
        'useAnim': true,
        'x': 65,
        'y': 54.238118860032046
    }
};

// var MAP_WIDTH = 750;
// var MAP_HEIGHT = 1334;
var MAP_WIDTH = 375;
var MAP_HEIGHT = 667;


var app = {
    isStart: true,
    init: function () {
        var ctx = this.ctx = Canvas.getContext('xx');
        ctx.setProjectionMatrix(0, MAP_WIDTH, 0, MAP_HEIGHT, -1024, 1024);
        this.globalScale = MAP_WIDTH / 840;
        this.tileWidth = 210 * this.globalScale;
        this.tileHeight = 86 * this.globalScale;
        this.minY = -(mapData.length - .5) * this.tileHeight + MAP_HEIGHT;
        this.currentY = this.minY;

        this.touchStartY = 0;
        this.touchStartCurrentY = 0;

        this.lastMoveY = null;
        this.lastDiff = 0;

        this.currentSpeed = 0;
        this.currentAcceleration = 0;

        this.initMapData();

        this.isStart = true;
        ctx.test();
        ctx.draw();
    },
    touchstart: function (evt) {
        var touchs = evt.changedTouches;
        this.touchStartY = touchs[0].screenY;
        this.touchStartCurrentY = this.currentY;
        this.currentSpeed = 0;
        this.currentAcceleration = 0;
        this.lastMoveY = null;
        this.lastDiff = 0;

        this.isTouched = true;
    },
    touchmove: function (evt) {
        var touchs = evt.changedTouches;
        this.currentY = this.touchStartCurrentY + touchs[0].screenY - this.touchStartY;
        if (this.lastMoveY !== null) {
            this.lastDiff = touchs[0].screenY - this.lastMoveY;
        }
        this.lastMoveY = touchs[0].screenY;

        this.render(true);
    },
    touchend: function (evt) {
        var touchs = evt.changedTouches;
        var diff = touchs[0].screenY - this.touchStartY;
        this.currentY = this.touchStartCurrentY + diff;

        this.currentAcceleration = this.lastDiff > 0 ? 1 : -1;
        this.currentSpeed = Math.ceil(this.lastDiff);
        // nativeLog(this.currentSpeed, this.currentAcceleration);
        this.isTouched = false;
    },
    getItemPos: function (img, x, y) {
        return {
            x: x * this.tileWidth - (y % 2 ? 0 : this.tileWidth / 2),
            y: (y - 1) * this.tileHeight - img.height * this.globalScale + this.tileHeight
        }
    },
    isVisible: function (y) {
        return y > -this.tileHeight*2 && y < MAP_HEIGHT;
    },
    initMapData: function () {
        var self = this;
        var items = this.items = [];
        var seaHeight = 164 * this.globalScale;
        var maxY = mapData.length * this.tileHeight;
        for (var i = 0; i < maxY; i += seaHeight) {
            items.push({
                url: '//gw.alicdn.com/tfscom/TB1oJsAJVXXXXbFXpXXkhHjUFXX-840-164.png',
                width: 840 * self.globalScale,
                height: seaHeight,
                x: 0,
                y: i
            });
        }

        mapData.forEach(function (cols, i) {
            cols.forEach(function (d, j) {
                if (!d || d === '102' || d === '101') {
                    return;
                }
                var img = imgsMap['map/' + d + '.png'];
                var pos = self.getItemPos(img, j, i);

                if (d === 'entry_center') {
                    pos.x -= self.tileWidth;
                    pos.y += self.tileHeight;
                }

                items.push({
                    url: img.url,
                    width: img.width * self.globalScale,
                    height: img.height * self.globalScale,
                    x: pos.x,
                    y: pos.y
                });

                if (animConfig['anim_' + d]) {
                    var animcfg = animConfig['anim_' + d];
                    var img = imgsMap['anim/anim_' + d + '.png'];
                    var item = {
                        isAnim: true,
                        currentIndex: 0,
                        url: img.url,
                        row: animcfg.row,
                        col: animcfg.col,
                        width: img.width / animcfg.col,
                        height: img.height / animcfg.row,
                        x: pos.x + animcfg.x * 2 * self.globalScale,
                        y: pos.y + animcfg.y * 2 * self.globalScale
                    };
                    item.frame = animcfg.frame.split(',').map(function (index) {
                        return [index % animcfg.col * item.width, Math.floor(index / animcfg.col) * item.height];
                    });
                    items.push(item);
                }
            });
        });
    },
    tick: function () {
        this.currentY += 1.5;
        if (this.currentY >= 0) {
            this.currentY = this.minY;
        }
        this.render();
    },
    render: function (isForce) {
        if ((!this.isStart || this.isTouched) && !isForce) {
            return;
        }
        this.isStart = false;

        this.currentY += this.currentSpeed;
        if (this.currentSpeed) {
            this.currentSpeed -= this.currentAcceleration;
        }
        if (this.currentY < this.minY) {
            this.currentY = this.minY;
        } else if (this.currentY > 0) {
            this.currentY = 0;
        }

        var self = this;
        var ctx = this.ctx;

        ctx.glClearColor(0, 0, 0, 1);
        ctx.glClear();

        this.items.forEach(function (item) {
            var y = item.y + self.currentY;
            if (self.isVisible(y)) {
                if (!item.isAnim) {
                    ctx.drawImage(item.url, item.x, y, item.width, item.height);
                } else {
                    var frame = item.frame[Math.floor(item.currentIndex)];
                    ctx.drawImage(item.url, frame[0], frame[1], item.width, item.height, item.x, y, item.width * self.globalScale, item.height * self.globalScale);
                    item.currentIndex += .05;
                    if (item.currentIndex >= item.frame.length) {
                        item.currentIndex = 0;
                    }
                }
            }
        });

        var self = this;
        ctx.draw(function () {
            self.isStart = true;
        });
    }
}

app.init();
setInterval(app.tick.bind(app), 16);