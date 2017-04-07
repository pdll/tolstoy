export default (sequelize, DataTypes) => {
  const Tag = sequelize.define(
    'Tag',
    {
      post_id: {
        field: 'post_id',
        type: DataTypes.INTEGER,
        references: { model: 'posts', key: 'id' }
      },
      name: {
        type: DataTypes.STRING
      }
    },
    {
      tableName: 'tags',
      underscored: true,
      classMethods: {
        associate: (models) => {
          Tag.belongsTo(models.Post)
        }
      }
    }
  )

  return Tag
}