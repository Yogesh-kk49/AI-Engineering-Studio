from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('analyzer', '0005_analysis_user'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='repositoryanalysis',
            options={'ordering': ['-created_at', '-id']},
        ),
    ]