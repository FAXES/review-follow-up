const config = require('../config.json');
const extConfig = require('./configs/reviewfollowup.json');
const ms = require('ms');
const {ButtonBuilder, ButtonStyle, EmbedBuilder, ActionRowBuilder} = require('discord.js')

module.exports = async function(app, connection, bot, faxstore) {
    // Setup the database...
    connection.query("SHOW TABLES LIKE 'ext_reviewfollowup'", async function (err, r) {
        if(r.length <= 0) {
            console.log(`\x1b[34m\x1b[1m[AUTO-UPDATE]:\x1b[0m Updating 'ext-reviewfollowup' SQL table (creating).\x1b[0m`);
            await connection.query("CREATE TABLE ext_reviewfollowup(id INT NOT NULL AUTO_INCREMENT,userId TEXT NOT NULL,due TEXT NOT NULL,productName TEXT,createdAt TEXT,PRIMARY KEY (id));", function (err, r) {}); 
        }
    });

    // Register the extension.
    faxstore.registerExtension({
        name: 'Review Follow-up',
        description: 'Send a follow up email and/or Discord message to users that have recently bought an item and prompt them to review the product.',
        icon: 'https://weblutions.com/u/S2YpFV.webp',
        version: '1.0.2',
        author: 'FAXES',
        config: extConfig,
        url: 'https://github.com/FAXES/review-follow-up'
    }, __filename);

    function sendfuDiscord(e) {
        connection.query(`SELECT * FROM users WHERE userId = '${e.userId}' LIMIT 1`, function(err, user) {
            if(!user[0]) return;
            let discordUser = faxstore.discord.bot.users.cache.get(e.userId);
            if(discordUser) {
                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle(`How was your recent purchase?`)
                    .setURL(`${config.siteInformation.domain}/reviews/create`)
                    .setDescription(`Hey ${user[0].username},\n\nWe see you've recently purchased **${e.productName}**. How is it?`);
                const button = new ButtonBuilder()
                    .setLabel(`Leave a review`)
                    .setURL(`${config.siteInformation.domain}/reviews/create`)
                    .setStyle(ButtonStyle.Link);
                const row = new ActionRowBuilder().addComponents([button]);
                try {
                    discordUser.send({embeds: [embed], components: [row]}).catch(function(err) {return;});
                    if(extConfig.debug) console.log(`Sending Discord follow up to ${user[0].username} (${user[0].userId})`);
                } catch (err) {}
            }
        });
    }

    function sendfuEmail(e) {
        connection.query(`SELECT * FROM users WHERE userId = '${e.userId}' LIMIT 1`, function(err, user) {
            if(!user[0]) return;
            let message = `Hi ${user[0].username},<br><br>We see you've recently purchased <strong>${e.productName}</strong> from us. We want to see how your experience has been.<br><br>Consider <a href="${config.siteInformation.domain}/reviews/create">leaving us a review</a> so we can continue to grow to be our best, for you.<br><br>Thank you`
            sendEmail(user[0].userEmail, 'How was your recent purchase?', message, {});
            if(extConfig.debug) console.log(`Sending email follow up to ${user[0].username} (${user[0].userId})`);
        });
    }

    // Fetch checkouts and save them for a follow up prompt.
    faxstore.on('checkoutReturn', function(user, paymentId, cart) {
        let productID = cart[0];
        if(productID.includes('pack:')) {productID = productID.split('pack:')[0];}
        if(productID.includes('note:')) {productID = productID.split('note:')[0];}
        if(productID.includes('tebx:')) {productID = productID.split('tebx:')[0];}
        connection.query(`SELECT id,title FROM storeitems`, async function(err, storeResults) {
            let createdAt = Date.now();
            let due = Number(createdAt) + ms(extConfig.timeframe || '1w');
            let storeName = storeResults.find(e => e.id == productID)?.title || '';
            connection.query(`INSERT INTO ext_reviewfollowup (userId, due, productName, createdAt) VALUES ('${user.id}', '${due}', '${storeName?.replaceAll("'", "''")}', '${createdAt}')`);
        });
    });

    // Check for due follow up prompts.
    setInterval(() => {
        connection.query(`SELECT * FROM ext_reviewfollowup`, function(err, results) {
            let createdAt = Date.now();
            for (let i = 0; i < results.length; i++) {
                const e = results[i];
                if(createdAt > e.due) {
                    if(extConfig.useDiscord) sendfuDiscord(e);
                    if(extConfig.useEmail) sendfuEmail(e);
                    connection.query(`DELETE FROM ext_reviewfollowup WHERE id = ${e.id} LIMIT 1`, function(err, result) {});
                }
            }
        });
    }, ms('1h'));
}
