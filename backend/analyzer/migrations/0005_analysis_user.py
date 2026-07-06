from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('analyzer', '0004_scan_mode_and_repo_path_help'),
    ]

    operations = [
        migrations.AddField(
            model_name='repositoryanalysis',
            name='user',
            field=models.ForeignKey(
                blank=True,
                help_text="Owner of this analysis. Nullable for legacy rows created "
                          "before per-user isolation was added.",
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='analyses',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]