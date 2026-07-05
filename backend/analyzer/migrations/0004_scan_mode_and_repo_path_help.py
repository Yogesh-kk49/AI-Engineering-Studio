from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('analyzer', '0003_rename_analyzer_re_repo_ur_5e0f8a_idx_analyzer_re_repo_ur_f112bb_idx'),
    ]

    operations = [
        migrations.AddField(
            model_name='repositoryanalysis',
            name='scan_mode',
            field=models.CharField(
                choices=[('basic', 'Basic'), ('deep', 'Deep')],
                default='basic',
                db_index=True,
                help_text="'basic' = GitHub-API-only scan, no clone. "
                          "'deep' = full clone + architecture/quality/security/dependency analysis.",
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name='repositoryanalysis',
            name='repository_path',
            field=models.CharField(
                blank=True,
                help_text="On-disk path of the cached clone. Only ever set for Deep "
                          "Scans — Basic Scan never downloads/clones anything.",
                max_length=500,
            ),
        ),
    ]