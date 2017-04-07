export default (sequelize, DataTypes) => {
  const Program = sequelize.define(
    'Program',
    {
      name: {
        type: DataTypes.STRING
      },
      alias: {
        type: DataTypes.STRING
      },
      // booleans
      is_blocked: {
        defaultValue: false,
        type: DataTypes.BOOLEAN
      },
      is_visible: {
        defaultValue: true,
        type: DataTypes.BOOLEAN
      },
      // dates
      finish_at: {
        allowNull: false,
        type: DataTypes.DATE
      },
      start_at: {
        allowNull: false,
        type: DataTypes.DATE
      }
    },
    {
      tableName: 'programs',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      timestamps: true,
      underscored: true,
      classMethods: {
        associate: (models) => {
          Program.belongsToMany(models.Post, { through: 'programs_posts' })
        }
      }
    }
  )

  return Program
}