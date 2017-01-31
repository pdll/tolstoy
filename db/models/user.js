module.exports = function (sequelize, DataTypes) {
    var User = sequelize.define('User', {
        name: DataTypes.STRING,
        email: {type: DataTypes.STRING, unique: true},
        uid: {type: DataTypes.STRING(64)},
        first_name: DataTypes.STRING,
        last_name: DataTypes.STRING,
        birthday: DataTypes.DATE,
        gender: DataTypes.STRING(8),
        picture_small: DataTypes.STRING,
        picture_large: DataTypes.STRING,
        location_id: DataTypes.BIGINT.UNSIGNED,
        location_name: DataTypes.STRING,
        locale: DataTypes.STRING(12),
        timezone: DataTypes.INTEGER,
        remote_ip: DataTypes.STRING,
        verified: DataTypes.BOOLEAN,
        waiting_list: DataTypes.BOOLEAN,
        bot: DataTypes.BOOLEAN,
        vesting_total: DataTypes.DOUBLE,
        monets: DataTypes.INTEGER,
        money_total: DataTypes.INTEGER,
        polk: DataTypes.INTEGER,
        last_total_transaction: DataTypes.DATE,
        total: DataTypes.DOUBLE,
        posts_monets: DataTypes.INTEGER,
        comments_monets: DataTypes.INTEGER,
        tasks_monets: DataTypes.INTEGER
    }, {
        tableName: 'users',
        createdAt   : 'created_at',
        updatedAt   : 'updated_at',
        timestamps  : true,
        underscored : true,
        classMethods: {
            associate: function (models) {
                User.hasMany(models.Identity);
                User.hasMany(models.Account);
            }
        }
    });
    return User;
};
