export default (sequelize, DataTypes) => {
  const Post = sequelize.define(
    'Post',
    {
      user_id: {
        field: 'user_id',
        type: DataTypes.INTEGER,
        references: { model: 'users', key: 'id' }
      },
      title: {
        type: DataTypes.STRING
      },
      content: {
        type: DataTypes.TEXT
      },
      is_blocked: {
        defaultValue: false,
        type: DataTypes.BOOLEAN
      },
      is_visible: {
        defaultValue: true,
        type: DataTypes.BOOLEAN
      },
      type: {
        allowNull: false,
        defaultValue: 'user-feed',
        type: DataTypes.STRING
      }
    },
    {
      tableName: 'posts',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      timestamps: true,
      underscored: true,
      classMethods: {
        associate: (models) => {
          Post.belongsTo(models.User)
          Post.hasMany(models.Tag)
          Post.belongsToMany(models.Program, { through: 'programs_posts' })
        }
      }
    }
  )

  return Post
}